import {Router as ExpressRouter} from "express";
import {Worker} from "mediasoup/lib/Worker";
import * as mediasoup from "mediasoup";
import {MediasoupGetUrls, MediasoupPostUrls} from "./events";
import * as os from "os";
import {Router} from "mediasoup/lib/Router";
import {WebRtcTransport} from "mediasoup/lib/WebRtcTransport";
import {PlainTransport} from "mediasoup/lib/PlainTransport";
import {Producer} from "mediasoup/lib/Producer";
// @ts-ignore
import * as omit from "lodash.omit";
import * as admin from "firebase-admin";
import {DatabaseProducer} from "./model";
import {getGlobalProducer, getStageId} from "./util";
import {Consumer} from "mediasoup/lib/Consumer";

const debug = require('debug')('mediasoup');

const config = require("./config");
const connectionsPerCpu = 500;

let initialized: boolean = false;

const router: {
    router: Router,
    numConnections: number
}[] = [];

const transports: {
    webrtc: {
        [id: string]: WebRtcTransport
    },
    plain: {
        [id: string]: PlainTransport
    }
} = {
    webrtc: {},
    plain: {}
};

let producers: {
    [globalProducerId: string]: Producer
} = {};

let consumers: {
    [id: string]: Consumer
} = {};


const init = async () => {
    const cpuCount: number = os.cpus().length;
    const mediaCodecs = config.mediasoup.router.mediaCodecs;
    for (let i = 0; i < cpuCount; i++) {
        const worker: Worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.worker.logLevel,
            logTags: config.mediasoup.worker.logTags,
            rtcMinPort: config.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config.mediasoup.worker.rtcMaxPort
        });
        const workerRouter: Router = await worker.createRouter({mediaCodecs});
        router.push({router: workerRouter, numConnections: 0});
    }
    initialized = true;
};

const getAvailableRouter = (): Router | null => {
    for (let i = 0; i < router.length; i++) {
        if (router[i].numConnections < connectionsPerCpu) {
            return router[i].router;
        }
    }
    return null;
};

export default (ref: admin.database.Reference, ipv4: string, ipv6: string): ExpressRouter => {
    init();

    const express = ExpressRouter();

    express.get("/", (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        res.status(200).send("Alive and kick'n with " + router.length + " cores !");
    });

    express.get(MediasoupGetUrls.GetRTPCapabilities, (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        res.status(200).send(router[0].router.rtpCapabilities);
    });

    express.get(MediasoupGetUrls.CreateWebRTCTransport, (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        const router: Router | null = getAvailableRouter();
        if (!router) {
            return res.status(501).send("Full");
        }
        return router.createWebRtcTransport({
            preferTcp: false,
            listenIps: config.mediasoup.webRtcTransport.listenIps,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate
        }).then((transport: WebRtcTransport) => {
            transports.webrtc[transport.id] = transport;

            return res.status(200).send(JSON.stringify({
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
                sctpParameters: transport.sctpParameters,
                appData: transport.appData
            }));
        }).catch((error) => {
                console.error(error);
                return res.status(500).send({error: "Internal server error"});
            }
        )
    });


    express.get(MediasoupGetUrls.CreatePlainRTPTransport, (req, res, next) => {
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const router: Router | null = getAvailableRouter();
        if (!router) {
            return res.status(509).send("Full");
        }

        return router.createPlainTransport({
            listenIp: ipv6,
            rtcpMux: true,
            comedia: true
        }).then((transport: PlainTransport) => {
            transports.plain[transport.id] = transport;

            res.status(200).send(JSON.stringify({
                sctpParameters: transport.sctpParameters,
                appData: transport.appData
            }));
        }).catch((error) => {
            debug(error);
            return res.status(500).send({error: "Internal server error"});
        });
    });

    express.post(MediasoupPostUrls.ConnectTransport, (req, res, next) => {
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId} = req.body;
        if (!transportId) {
            return res.status(400).send("Bad Request");
        }
        const webRtcTransport: WebRtcTransport = transports.webrtc[transportId];
        if (webRtcTransport) {
            const {dtlsParameters} = req.body;
            if (!dtlsParameters) {
                return res.status(400).send("Bad Request");
            }
            return webRtcTransport.connect({dtlsParameters: dtlsParameters}).then(
                () => {
                    res.status(200).send();
                }
            ).catch((error) => {
                debug(error);
                return res.status(500).send({error: "Internal server error"});
            });
        }

        const plainTransport: PlainTransport = transports.plain[transportId];
        if (plainTransport) {
            const {ip, port, rtcpPort, srtpParameters} = req.body;
            if (!ip || !port || !rtcpPort || !srtpParameters) {
                return res.status(400).send("Bad Request");
            }
            return plainTransport.connect({
                ip: req.body.ip,
                port: req.body.port,
                rtcpPort: req.body.rtcpPort,
                srtpParameters: req.body.srtpParameters,
            }).then(
                () => {
                    res.status(200).send();
                }
            ).catch((error) => {
                debug(error);
                return res.status(500).send({error: "Internal server error"});
            });
        }
        return res.status(400).send("Not found");
    });

    express.post(MediasoupPostUrls.SendTrack, (req, res) => {
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {transportId, kind, rtpParameters} = req.body;
        if (!transportId || !kind || !rtpParameters) {
            return res.status(400).send("Bad Request");
        }
        const transport: any = transports.webrtc[transportId] || transports.plain[transportId];
        if (!transport) {
            return res.status(404).send("Not found");
        }
        return admin.auth()
            .verifyIdToken(req.headers.authorization)
            .then(async (decodedIdToken: admin.auth.DecodedIdToken) => {
                getStageId(decodedIdToken.uid)
                    .then(async (stageId: string) => {
                        const producer: Producer = await transport.produce({
                            kind: kind,
                            rtpParameters: rtpParameters
                        });
                        // Get global producer id
                        const producerRef: admin.database.Reference = await admin.database()
                            .ref("producers")
                            .push();
                        await producerRef.onDisconnect().remove();
                        await producerRef.set({
                            stageId: stageId,
                            uid: decodedIdToken.uid,
                            routerId: ref.key,
                            kind: producer.kind
                        } as DatabaseProducer);
                        const globalProducerId: string = producerRef.key;
                        producer.on("transportclose", () => {
                            debug("producer's transport closed", producer.id);
                            producerRef.remove().then(() => {
                                producers = omit(producers, globalProducerId);
                            })
                        });
                        producers[globalProducerId] = producer;
                        return res.status(200).send({
                            id: globalProducerId,
                            localProducerId: producer.id
                        });
                    })
            })
            .catch((error) => {
                debug(error);
                return res.status(403).send({error: "Forbidden"});
            });
    });

    express.post(MediasoupPostUrls.ConsumeWebRTC, (req, res) => {
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {transportId, globalProducerId, rtpCapabilities} = req.body;
        if (!transportId || !globalProducerId || !rtpCapabilities) {
            return res.status(400).send("Bad Request");
        }
        return admin.auth().verifyIdToken(req.headers.authorization)
            .then(async () => {
                const transport: WebRtcTransport = transports.webrtc[transportId];
                if (!transport) {
                    return res.status(400).send("Transport not found");
                }
                const producer: Producer = producers[globalProducerId];
                if (producer) {
                    // Is local
                    const consumer: Consumer = await transport.consume({
                        producerId: producer.id,
                        rtpCapabilities: rtpCapabilities,
                        paused: true
                    });
                    consumers[consumer.id] = consumer;
                    return res.status(200).send({
                        id: consumer.id,
                        producerId: consumer.producerId,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                        producerPaused: consumer.producerPaused,
                        type: consumer.type
                    });
                } else {
                    //TODO: Consume producer from target router
                    const databaseProducer: DatabaseProducer = await getGlobalProducer(globalProducerId);
                    //TODO ...
                }
                return res.status(404).send({error: "Could not find producer"});
            })
            .catch((error) => {
                debug(error);
                return res.status(403).send({error: "Forbidden"});
            });
    });

    express.post(MediasoupPostUrls.FinishConsume, (req, res) => {
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        return admin.auth().verifyIdToken(req.headers.authorization)
            .then(() => {
                const consumer: Consumer = consumers[req.body.consumerId];
                if (consumer) {
                    return consumer.resume().then(() => res.status(200).send());
                }
                return res.status(404).send({error: "Could not find consumer"});
            })
            .catch((error) => {
                debug(error);
                return res.status(403).send({error: "Forbidden"});
            });
    });

    return express;
}
