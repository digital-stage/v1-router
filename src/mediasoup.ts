import * as express from "express";
import {Worker} from "mediasoup/lib/Worker";
import * as mediasoup from "mediasoup";
import {RouterGetUrls, RouterPostUrls} from "./events";
import * as os from "os";
import {Router} from "mediasoup/lib/Router";
import {WebRtcTransport} from "mediasoup/lib/WebRtcTransport";
import {PlainTransport} from "mediasoup/lib/PlainTransport";
import {Producer} from "mediasoup/lib/Producer";
// @ts-ignore
import * as omit from "lodash.omit";
import * as admin from "firebase-admin";
import {DatabaseProducer} from "./model";
import {getStageId} from "./util";
import {Consumer} from "mediasoup/lib/Consumer";

const debug = require('debug')('mediasoup');

const config = require("./config");
const connectionsPerCpu = 500;

//TODO: Export verify token into cloud functions and use only realtime database client instead of admin sdk

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

interface LocalProducer {
    uid: string;
    producer: Producer
}

interface LocalConsumer {
    uid: string;
    consumer: Consumer
}

let localProducers: {
    [globalProducerId: string]: LocalProducer
} = {};

let localConsumers: {
    [localConsumerId: string]: LocalConsumer
} = {};

let forwardConsumers: {
    [localConsumerId: string]: LocalConsumer
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


export default (ref: admin.database.Reference, ipv4: string, ipv6: string): express.Router => {
    const routerId: string = ref.key;
    init();

    const getGlobalProducer = (globalProducerId: string): Promise<DatabaseProducer> => {
        return admin.database()
            .ref("producers/" + globalProducerId)
            .once("value")
            .then((snapshot) => {
                return snapshot.val() as DatabaseProducer;
            });
    }

    const app = express.Router();
    app.use(express.json());

    app.get("/", (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        return res.status(200).send("Alive and kick'n with " + router.length + " cores !");
    });

    app.get("/ping", (req, res, next) => {
        return res
            .set('Content-Type', 'image/svg+xml')
            .status(200)
            .send("<svg height=\"200\" width=\"580\" xmlns=\"http://www.w3.org/2000/svg\">\n" +
            "    <path d=\"m-1-1h582v402h-582z\"/>\n" +
            "    <path d=\"m223 148.453125h71v65h-71z\" stroke=\"#000\" stroke-width=\"1.5\"/>\n" +
            "</svg>");
    });

    app.get(RouterGetUrls.GetRTPCapabilities, (req, res, next) => {
        debug(RouterGetUrls.GetRTPCapabilities);
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        res.status(200).send(router[0].router.rtpCapabilities);
    });

    /***
     * /transport/webrtc
     */
    app.get(RouterGetUrls.CreateTransport, (req, res, next) => {
        debug(RouterGetUrls.CreateTransport);
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
                id: transport.id,
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
    app.post(RouterPostUrls.ConnectTransport, (req, res, next) => {
        debug(RouterPostUrls.ConnectTransport);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, dtlsParameters} = req.body;
        if (!transportId || !dtlsParameters) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const webRtcTransport: WebRtcTransport = transports.webrtc[transportId];
        if (webRtcTransport) {
            return webRtcTransport.connect({dtlsParameters: dtlsParameters}).then(
                () => res.status(200).send()
            ).catch((error) => {
                debug(error);
                return res.status(500).send({error: "Internal server error"});
            });
        }
        return res.status(400).send("Not found");
    });
    app.post(RouterPostUrls.CloseTransport, (req, res, next) => {
        debug(RouterPostUrls.CloseTransport);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, dtlsParameters} = req.body;
        if (!transportId || !dtlsParameters) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const webRtcTransport: WebRtcTransport = transports.webrtc[transportId];
        if (webRtcTransport) {
            webRtcTransport.close();
            transports.webrtc = omit(transports.webrtc, transportId);
            return res.status(200).send();
        }
        return res.status(400).send("Not found");
    });


    /***
     * /transport/plain
     */
    app.get(RouterGetUrls.CreatePlainTransport, (req, res, next) => {
        debug(RouterGetUrls.CreatePlainTransport);
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
            return res.status(200).send(JSON.stringify({
                id: transport.id,
                sctpParameters: transport.sctpParameters,
                appData: transport.appData
            }));
        }).catch((error) => {
            debug(error);
            return res.status(500).send({error: "Internal server error"});
        });
    });
    app.get(RouterPostUrls.ConnectPlainTransport, (req, res, next) => {
        debug(RouterPostUrls.ConnectPlainTransport);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, ip, port, rtcpPort, srtpParameters} = req.body;
        if (!transportId || !ip || !port || !rtcpPort || !srtpParameters) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const plainTransport: PlainTransport = transports.plain[transportId];
        if (plainTransport) {
            return plainTransport.connect({
                ip: ip,
                port: port,
                rtcpPort: rtcpPort,
                srtpParameters: srtpParameters,
            }).then(
                () => res.status(200).send()
            ).catch((error) => {
                debug(error);
                return res.status(500).send({error: "Internal server error"});
            });
        }
    });
    app.post(RouterPostUrls.ClosePlainTransport, (req, res, next) => {
        debug(RouterPostUrls.ClosePlainTransport);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, dtlsParameters} = req.body;
        if (!transportId || !dtlsParameters) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const plainTransport: PlainTransport = transports.plain[transportId];
        if (plainTransport) {
            plainTransport.close();
            transports.plain = omit(transports.plain, transportId);
            return res.status(200).send();
        }
        return res.status(400).send("Not found");
    });


    /***
     *
     */
    app.post(RouterPostUrls.CreateProducer, (req, res) => {
        debug(RouterPostUrls.CreateProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {transportId, kind, rtpParameters, deviceId} = req.body;
        if (!transportId || !kind || !rtpParameters || !deviceId) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        return admin.auth()
            .verifyIdToken(req.headers.authorization)
            .then(async (decodedIdToken: admin.auth.DecodedIdToken) => {
                const transport: any = transports.webrtc[transportId];
                if (!transport) {
                    return res.status(404).send("Transport not found");
                }
                const stageId: string = await getStageId(decodedIdToken.uid);
                const producer: Producer = await transport.produce({
                    kind: kind,
                    rtpParameters: rtpParameters
                });
                // Get global producer id
                const producerRef: admin.database.Reference = await admin.database()
                    .ref("producers")
                    .push({
                        stageId: stageId,
                        uid: decodedIdToken.uid,
                        routerId: ref.key,
                        deviceId: deviceId,
                        kind: producer.kind
                    } as DatabaseProducer);
                await producerRef.onDisconnect().remove();
                const globalProducerId: string = producerRef.key;
                producer.on("transportclose", () => {
                    debug("producer's transport closed", producer.id);
                    producerRef.remove().then(() => {
                        localProducers = omit(localProducers, globalProducerId);
                    })
                });
                localProducers[globalProducerId] = {
                    uid: decodedIdToken.uid,
                    producer: producer
                };
                return res.status(200).send({
                    id: globalProducerId,
                    localProducerId: producer.id
                });
            })
            .catch((error) => {
                debug(error);
                return res.status(403).send({error: error});
            })
    });
    app.post(RouterPostUrls.PauseProducer, (req, res) => {
        debug(RouterPostUrls.CreateProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {globalProducerId} = req.body;
        if (!globalProducerId) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        return admin.auth()
            .verifyIdToken(req.headers.authorization)
            .then(async (decodedIdToken: admin.auth.DecodedIdToken) => {
                const localProducer: LocalProducer = localProducers[globalProducerId];
                if (localProducer) {
                    if (localProducer.uid === decodedIdToken.uid) {
                        return localProducer.producer.pause().then(() => res.status(200).send());
                    }
                    return res.status(403).send({error: "Forbidden"});
                }
                const globalProducer: DatabaseProducer = await getGlobalProducer(globalProducerId);
                if (globalProducer.uid !== decodedIdToken.uid)
                    return res.status(403).send({error: "Forbidden"});
                // TODO: Use global producer to pause producer on target router

                return res.status(404).send("Transport not found");
            });
    });
    app.post(RouterPostUrls.ResumeProducer, (req, res) => {
        debug(RouterPostUrls.ResumeProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {globalProducerId} = req.body;
        if (!globalProducerId) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        return admin.auth()
            .verifyIdToken(req.headers.authorization)
            .then(async (decodedIdToken: admin.auth.DecodedIdToken) => {
                const localProducer: LocalProducer = localProducers[globalProducerId];
                if (localProducer) {
                    if (localProducer.uid === decodedIdToken.uid) {
                        return localProducer.producer.resume().then(() => res.status(200).send());
                    }
                    return res.status(403).send({error: "Forbidden"});
                }
                const globalProducer: DatabaseProducer = await getGlobalProducer(globalProducerId);
                if (globalProducer.uid !== decodedIdToken.uid)
                    return res.status(403).send({error: "Forbidden"});
                // TODO: Use global producer to resume producer on target router

                return res.status(404).send("Producer not found");
            });
    });
    app.post(RouterPostUrls.CloseProducer, (req, res) => {
        debug(RouterPostUrls.CloseProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {globalProducerId} = req.body;
        if (!globalProducerId) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        return admin.auth()
            .verifyIdToken(req.headers.authorization)
            .then(async (decodedIdToken: admin.auth.DecodedIdToken) => {
                const localProducer: LocalProducer = localProducers[globalProducerId];
                if (localProducer) {
                    if (localProducer.uid === decodedIdToken.uid) {
                        localProducer.producer.close();
                        return admin.database()
                            .ref("producers/" + globalProducerId)
                            .remove()
                            .then(() => res.status(200).send());
                    }
                    return res.status(403).send({error: "Forbidden"});
                }
                const globalProducer: DatabaseProducer = await getGlobalProducer(globalProducerId);
                if (globalProducer.uid !== decodedIdToken.uid)
                    return res.status(403).send({error: "Forbidden"});
                // TODO: Use global producer to close producer on target router

                return res.status(404).send("Producer not found");
            });
    });


    app.post(RouterPostUrls.CreateConsumer, (req, res) => {
        debug(RouterPostUrls.CreateConsumer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {transportId, globalProducerId, rtpCapabilities} = req.body;
        if (!transportId || !globalProducerId || !rtpCapabilities) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        return admin.auth().verifyIdToken(req.headers.authorization)
            .then(async (decodedIdToken: admin.auth.DecodedIdToken) => {
                const localProducer: LocalProducer = localProducers[globalProducerId];
                if (localProducer) {
                    const transport: WebRtcTransport = transports.webrtc[transportId];
                    if (!transport) {
                        return res.status(400).send("Transport not found");
                    }
                    const consumer: Consumer = await transport.consume({
                        producerId: localProducer.producer.id,
                        rtpCapabilities: rtpCapabilities,
                        paused: true
                    });
                    localConsumers[consumer.id] = {
                        uid: decodedIdToken.uid,
                        consumer: consumer
                    };
                    return res.status(200).send({
                        id: consumer.id,
                        producerId: consumer.producerId,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                        producerPaused: consumer.producerPaused,
                        type: consumer.type
                    });
                }
                const databaseProducer: DatabaseProducer = await getGlobalProducer(globalProducerId);
                //TODO: Create forward consumer for this producer on other router and let this consumer
                //TODO: consume this producer

                return res.status(404).send({error: "Could not find producer"});
            })
            .catch((error) => {
                debug(error);
                return res.status(403).send({error: "Forbidden"});
            });
    });
    app.post(RouterPostUrls.PauseConsumer, (req, res) => {
        debug(RouterPostUrls.PauseConsumer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {consumerId} = req.body;
        if (!consumerId) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        return admin.auth()
            .verifyIdToken(req.headers.authorization)
            .then(async (decodedIdToken: admin.auth.DecodedIdToken) => {
                const localConsumer: LocalConsumer = localConsumers[consumerId];
                if (localConsumer) {
                    if (localConsumer.uid === decodedIdToken.uid) {
                        return localConsumer.consumer.pause().then(() => res.status(200).send());
                    }
                    return res.status(403).send({error: "Forbidden"});
                }
                const forwardConsumer: LocalConsumer = forwardConsumers[consumerId];
                if (forwardConsumer.uid !== decodedIdToken.uid)
                    return res.status(403).send({error: "Forbidden"});
                // TODO: Use global producer to pause producer on target router

                return res.status(404).send("Consumer not found");
            });
    });
    app.post(RouterPostUrls.ResumeProducer, (req, res) => {
        debug(RouterPostUrls.ResumeProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {consumerId} = req.body;
        if (!consumerId) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        return admin.auth()
            .verifyIdToken(req.headers.authorization)
            .then(async (decodedIdToken: admin.auth.DecodedIdToken) => {
                const localConsumer: LocalConsumer = localConsumers[consumerId];
                if (localConsumer) {
                    if (localConsumer.uid === decodedIdToken.uid) {
                        return localConsumer.consumer.resume().then(() => res.status(200).send());
                    }
                    return res.status(403).send({error: "Forbidden"});
                }
                const forwardConsumer: LocalConsumer = forwardConsumers[consumerId];
                if (forwardConsumer.uid !== decodedIdToken.uid)
                    return res.status(403).send({error: "Forbidden"});
                // TODO: Use global producer to resume producer on target router

                return res.status(404).send("Transport not found");
            });
    });
    app.post(RouterPostUrls.CloseProducer, (req, res) => {
        debug(RouterPostUrls.CloseProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {consumerId} = req.body;
        if (!consumerId) {
            debug("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        return admin.auth()
            .verifyIdToken(req.headers.authorization)
            .then(async (decodedIdToken: admin.auth.DecodedIdToken) => {
                const localConsumer: LocalConsumer = localConsumers[consumerId];
                if (localConsumer) {
                    if (localConsumer.uid === decodedIdToken.uid) {
                        localConsumer.consumer.close()
                        return res.status(200).send();
                    }
                    return res.status(403).send({error: "Forbidden"});
                }
                const forwardConsumer: LocalConsumer = forwardConsumers[consumerId];
                if (forwardConsumer.uid !== decodedIdToken.uid)
                    return res.status(403).send({error: "Forbidden"});
                // TODO: Use global producer to resume producer on target router

                return res.status(404).send("Transport not found");
            });
    });

    return app;
}
