import {Router as ExpressRouter} from "express";
import {Worker} from "mediasoup/lib/Worker";
import * as mediasoup from "mediasoup";
import {MediasoupGetUrls, MediasoupPostUrls} from "./events";
import * as os from "os";
import {Router} from "mediasoup/lib/Router";
import {DtlsParameters, WebRtcTransport} from "mediasoup/lib/WebRtcTransport";
import {PlainTransport} from "mediasoup/lib/PlainTransport";
import {Producer} from "mediasoup/lib/Producer";
// @ts-ignore
import * as omit from "lodash.omit";
import fetch from "node-fetch";
import * as admin from "firebase-admin";

const debug = require('debug')('mediasoup');

const config = require("./config");
const connectionsPerCpu = 500;

let initialized: boolean = false;
const router: {
    router: Router,
    numConnections: number
}[] = [];
const clientTransports: {
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
const serverTransports: {
    [serverId: string]: {
        webrtc: {
            receiveTransport: WebRtcTransport,
            sendTransport: WebRtcTransport
        },
        plain: {
            receiveTransport: PlainTransport,
            sendTransport: PlainTransport
        }
    }
} = {};
const routers: {
    [routerId: string]: DigitalStageRouter
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

export default (routerId: string, ipv4: string, ipv6: string): ExpressRouter => {
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
        if (!req.headers.authorization) {
            return res.status(501).send("Missing authorization");
        }
        admin.auth().verifyIdToken(req.headers.authorization)
            .then((decodedIdToken: admin.auth.DecodedIdToken) => {
                const router: Router | null = getAvailableRouter();
                if (!router) {
                    return res.status(501).send("Full");
                }

                router.createWebRtcTransport({
                    preferTcp: false,
                    listenIps: config.mediasoup.webRtcTransport.listenIps,
                    enableUdp: true,
                    enableTcp: true,
                    preferUdp: true,
                    initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate
                }).then((transport: WebRtcTransport) => {
                    if (decodedIdToken.uid === "admin" && req.body.routerId) {
                        //TODO: Do we have to integrate the client here?
                        error
                        serverTransports[req.body.routerId].webrtc.receiveTransport = transport;
                    } else {
                        clientTransports.webrtc[transport.id] = transport;
                    }

                    res.status(200).send(JSON.stringify({
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                        sctpParameters: transport.sctpParameters,
                        appData: transport.appData
                    }));
                }).catch((error) => {
                        console.error(error);
                        res.status(501).send("Error");
                    }
                )
            })
            .catch((error) => {
                debug(error);
                return res.status(501).send({error: "Invalid authorization header"});
            });
    });


    express.get(MediasoupGetUrls.CreatePlainRTPTransport, (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        if (!req.headers.authorization) {
            return res.status(501).send("Missing authorization");
        }
        admin.auth().verifyIdToken(req.headers.authorization)
            .then((decodedIdToken: admin.auth.DecodedIdToken) => {
                const router: Router | null = getAvailableRouter();
                if (!router) {
                    return res.status(501).send("Full");
                }

                router.createPlainTransport({
                    listenIp: ipv6,
                    rtcpMux: true,
                    comedia: true
                }).then((transport: PlainTransport) => {
                    clientTransports.plain[transport.id] = transport;

                    res.status(200).send(JSON.stringify({
                        sctpParameters: transport.sctpParameters,
                        appData: transport.appData
                    }));
                }).catch((error) => {
                    debug(error);
                    return res.status(501).send({error: "Internal server error"});
                });
            })
            .catch((error) => {
                debug(error);
                return res.status(501).send({error: "Invalid authorization header"});
            });
    });

    express.post(MediasoupPostUrls.ConnectTransport, (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        if (!req.body.transportId) {
            return res.status(501).send("Invalid request");
        }
        admin.auth().verifyIdToken(req.headers.authorization)
            .then((decodedIdToken: admin.auth.DecodedIdToken) => {
                const transportId: string = req.body.transportId;
                const dtlsParameters: DtlsParameters = JSON.parse(req.body.dtlsParameters);

                const webRtcTransport: WebRtcTransport = clientTransports.webrtc[transportId];
                if (webRtcTransport) {
                    if (!req.body.dtlsParameters) {
                        return res.status(501).send("Invalid request");
                    }
                    return webRtcTransport.connect({dtlsParameters: dtlsParameters}).then(
                        () => {
                            res.status(200).send();
                        }
                    ).catch((error) => {
                        debug(error);
                        return res.status(501).send({error: "Internal server error"});
                    });
                }
                const plainTransport: PlainTransport = clientTransports.plain[transportId];
                if (plainTransport) {
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
                        return res.status(501).send({error: "Internal server error"});
                    });
                }
                return res.status(400).send("Not found");
            })
            .catch((error) => {
                debug(error);
                return res.status(501).send({error: "Invalid authorization header"});
            });
    });

    express.post(MediasoupPostUrls.SendTrack, (req, res) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        if (!req.body.transportId) {
            return res.status(501).send("Invalid request");
        }
        const transport: any = clientTransports.webrtc[req.body.transportId] || clientTransports.plain[req.body.transportId];
        if (!transport) {
            return res.status(400).send("Not found");
        }
        admin.auth().verifyIdToken(req.headers.authorization)
            .then((decodedIdToken: admin.auth.DecodedIdToken) => {
                transport.produce({
                    kind: req.body.kind,
                    rtpParameters: req.body.rtpParameters
                }).then((producer: Producer) => {
                    producer.on("transportclose", () => {
                        debug("producer's transport closed", producer.id);
                        admin.firestore().collection("producers").doc(producer.id).delete().then(() => {
                            this.producers = omit(this.producers, producer.id);
                        });
                    });
                    this.producers[producer.id] = producer;
                    // Write to database
                    return admin.firestore().collection("producers").doc(producer.id)
                        .set({
                            uid: decodedIdToken.uid,
                            routerId: routerId
                        })
                        .then(() => {
                            return res.status(200).send({
                                id: producer.id
                            });
                        })
                        .catch((error) => {
                            debug(error);
                            return res.status(501).send({error: "Internal server error"});
                        });
                });
            })
            .catch((error) => {
                debug(error);
                return res.status(501).send({error: "Invalid authorization header"});
            });
    });

    express.post(MediasoupPostUrls.ConsumeWebRTC, (req, res) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        return admin.auth().verifyIdToken(req.headers.authorization)
            .then((decodedIdToken: admin.auth.DecodedIdToken) => {
                const {transportId, producerId, routerId: reqRouterId} = req.body;
                if (!transportId || !producerId || !routerId) {
                    return res.status(501).send("Invalid request");
                }
                const transport: any = clientTransports.webrtc[transportId];
                if (!transport) {
                    return res.status(400).send("Transport not found");
                }
                if (routerId === reqRouterId) {
                    // This is the correct router
                } else {
                    // Use other router
                    const transports = serverTransports[reqRouterId];
                    if (!transports) {
                        return res.status(400).send("Router not found");
                    }

                }

                //TODO: If router differs, create consumer to other router using existing transports to the other router


            })
            .catch((error) => {
                debug(error);
                return res.status(501).send({error: "Invalid authorization header"});
            });
    });

    express.post(MediasoupPostUrls.ConsumePlain, (req, res) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        return admin.auth().verifyIdToken(req.headers.authorization)
            .then((decodedIdToken: admin.auth.DecodedIdToken) => {
                const {transportId, producerId, routerId: reqRouterId} = req.body;
                if (!transportId || !producerId || !routerId) {
                    return res.status(501).send("Invalid request");
                }
                const transport: any = clientTransports.plain[transportId];
                if (!transport) {
                    return res.status(400).send("Transport not found");
                }
                if (routerId === reqRouterId) {
                    // This is the correct router
                } else {
                    // Use other router
                    const transports = serverTransports[reqRouterId];
                    if (!transports) {
                        return res.status(400).send("Router not found");
                    }
                }

                //TODO: If router differs, create consumer to other router using existing transports to the other router


            })
            .catch((error) => {
                debug(error);
                return res.status(501).send({error: "Invalid authorization header"});
            });
    });

    // Create connection to all existing servers
    admin.firestore().collection("router").onSnapshot((snapshot: admin.firestore.QuerySnapshot) => {
        snapshot.docs.forEach((doc) => {
            if (!routers[doc.id]) {
                routers[doc.id] = doc.data() as DigitalStageRouter;
                // New router
                const token = admin.auth().createCustomToken("admin");
                fetch(routers[doc.id].ipv6 + ":" + routers[doc.id].port + MediasoupGetUrls.CreateWebRTCTransport, {
                    method: "POST",
                    headers: {
                        authorization: JSON.stringify(token)
                    },
                    body: JSON.stringify({
                        routerId: routerId
                    })
                }).then(() => {

                }).catch((error) => debug(error));
            }
        });
    });

    return express;
}
