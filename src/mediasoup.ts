import express from "express";
import {Worker} from "mediasoup/lib/Worker";
import * as mediasoup from "mediasoup";
import {RouterGetUrls, RouterPostUrls} from "./events";
import * as os from "os";
import {Router} from "mediasoup/lib/Router";
import {WebRtcTransport} from "mediasoup/lib/WebRtcTransport";
import {PlainTransport} from "mediasoup/lib/PlainTransport";
import {Producer} from "mediasoup/lib/Producer";
import omit from "lodash.omit";
import {Consumer} from "mediasoup/lib/Consumer";
import {getProducer} from "./index";

const logRequest = require('debug')('router:Request'),
    log = require('debug')('router:Info'),
    warn = require('debug')('router:Warn'),
    error = require('debug')('router:Error');

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

let localProducers: {
    [id: string]: Producer
} = {};

let localConsumers: {
    [id: string]: Consumer
} = {};

let forwardConsumers: {
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


export default (routerId: string, ipv4: string, ipv6: string): express.Router => {
    init();

    const app = express.Router();
    app.use(express.json());

    app.get("/", (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        return res.status(200).send("Alive and kick'n with " + router.length + " cores !");
    });

    app.get("/ping", (req, res, next) => {
        logRequest("Pinged by " + req.ip);
        return res
            .set('Content-Type', 'image/svg+xml')
            .status(200)
            .send("<svg height=\"200\" width=\"580\" xmlns=\"http://www.w3.org/2000/svg\">\n" +
                "    <path d=\"m-1-1h582v402h-582z\"/>\n" +
                "    <path d=\"m223 148.453125h71v65h-71z\" stroke=\"#000\" stroke-width=\"1.5\"/>\n" +
                "</svg>");
    });

    app.get(RouterGetUrls.GetRTPCapabilities, (req, res, next) => {
        logRequest(RouterGetUrls.GetRTPCapabilities);
        if (!initialized) {
            error("Router is not ready yet");
            return res.status(501).send("Not ready yet");
        }
        res.status(200).send(router[0].router.rtpCapabilities);
    });

    /***
     * /transport/webrtc
     */
    app.get(RouterGetUrls.CreateTransport, (req, res, next) => {
        logRequest(RouterGetUrls.CreateTransport);
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        const router: Router | null = getAvailableRouter();
        if (!router) {
            error("Router is full");
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
        }).catch((err) => {
                error(err);
                return res.status(500).send({error: "Internal server error"});
            }
        )
    });
    app.post(RouterPostUrls.ConnectTransport, (req, res, next) => {
        logRequest(RouterPostUrls.ConnectTransport);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, dtlsParameters} = req.body;
        if (!transportId || !dtlsParameters) {
            warn("Invalid body: " + req.body);
            console.log(req.body);
            return res.status(400).send("Bad Request");
        }
        const webRtcTransport: WebRtcTransport = transports.webrtc[transportId];
        if (webRtcTransport) {
            return webRtcTransport.connect({dtlsParameters: dtlsParameters}).then(
                () => res.status(200).send({})
            ).catch((error) => {
                warn(error);
                return res.status(500).send({error: "Internal server error"});
            });
        }
        warn('Could not find transport: ' + transportId);
        return res.status(400).send("Not found");
    });
    app.post(RouterPostUrls.CloseTransport, (req, res, next) => {
        logRequest(RouterPostUrls.CloseTransport);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, dtlsParameters} = req.body;
        if (!transportId || !dtlsParameters) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const webRtcTransport: WebRtcTransport = transports.webrtc[transportId];
        if (webRtcTransport) {
            webRtcTransport.close();
            transports.webrtc = omit(transports.webrtc, transportId);
            return res.status(200).send({});
        }
        warn('Could not find transport: ' + transportId);
        return res.status(400).send("Not found");
    });


    /***
     * /transport/plain
     */
    app.get(RouterGetUrls.CreatePlainTransport, (req, res, next) => {
        logRequest(RouterGetUrls.CreatePlainTransport);
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
        }).catch((err) => {
            error(err);
            return res.status(500).send({error: "Internal server error"});
        });
    });
    app.get(RouterPostUrls.ConnectPlainTransport, (req, res, next) => {
        logRequest(RouterPostUrls.ConnectPlainTransport);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, ip, port, rtcpPort, srtpParameters} = req.body;
        if (!transportId || !ip || !port || !rtcpPort || !srtpParameters) {
            warn("Invalid body: " + req.body);
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
                () => res.status(200).send({})
            ).catch((err) => {
                error(err);
                return res.status(500).send({error: "Internal server error"});
            });
        }
    });
    app.post(RouterPostUrls.ClosePlainTransport, (req, res, next) => {
        logRequest(RouterPostUrls.ClosePlainTransport);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, dtlsParameters} = req.body;
        if (!transportId || !dtlsParameters) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const plainTransport: PlainTransport = transports.plain[transportId];
        if (plainTransport) {
            plainTransport.close();
            transports.plain = omit(transports.plain, transportId);
            return res.status(200).send({});
        }
        warn('Could not find transport: ' + transportId);
        return res.status(400).send("Not found");
    });


    /***
     *
     */
    app.post(RouterPostUrls.CreateProducer, (req, res) => {
        logRequest(RouterPostUrls.CreateProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, kind, rtpParameters} = req.body;
        if (!transportId || !kind || !rtpParameters) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const transport: any = transports.webrtc[transportId];
        if (!transport) {
            warn('Could not find transport: ' + transportId);
            return res.status(404).send("Transport not found");
        }
        return transport.produce({
            kind: kind,
            rtpParameters: rtpParameters
        })
            .then((producer: Producer) => {
                producer.on("transportclose", () => {
                    log("producer's transport closed", producer.id);
                });
                log("Created producer and producer is: " + (producer.paused ? "paused" : "running"));
                localProducers[producer.id] = producer;
                return res.status(200).send({
                    id: producer.id
                });
            });
    });

    app.post(RouterPostUrls.PauseProducer, (req, res) => {
        logRequest(RouterPostUrls.PauseProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        if (!req.headers.authorization) {
            return res.status(511).send({error: "Authentication Required"});
        }
        const {id} = req.body;
        if (!id) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const producer: Producer = localProducers[id];
        if (producer) {
            return producer.pause().then(() => res.status(200).send({}));
        }

        warn('Could not find transport: ' + id);
        return res.status(404).send("Transport not found");
    });

    app.post(RouterPostUrls.ResumeProducer, (req, res) => {
        logRequest(RouterPostUrls.ResumeProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {id} = req.body;
        if (!id) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const producer: Producer = localProducers[id];
        if (producer) {
            return producer.resume().then(() => res.status(200).send({}));
        }
        warn('Could not find producer: ' + id);
        return res.status(404).send("Producer not found");
    });

    app.post(RouterPostUrls.CloseProducer, (req, res) => {
        logRequest(RouterPostUrls.CloseProducer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {id} = req.body;
        if (!id) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const producer: Producer = localProducers[id];
        if (producer) {
            producer.close();
            return res.status(200).send({});
        }
        warn('Could not find producer: ' + id);
        return res.status(404).send("Producer not found");
    });


    app.post(RouterPostUrls.CreateConsumer, (req, res) => {
        logRequest(RouterPostUrls.CreateConsumer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {transportId, globalProducerId, rtpCapabilities} = req.body;
        if (!transportId || !globalProducerId || !rtpCapabilities) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }

        return getProducer(globalProducerId)
            .then(async producer => {
                if (producer) {
                    if (producer.routerId === routerId) {
                        // This is the right router
                        if (localProducers[producer._id]) {
                            const transport: WebRtcTransport = transports.webrtc[transportId];
                            if (!transport) {
                                return res.status(400).send("Transport not found");
                            }
                            const consumer: Consumer = await transport.consume({
                                producerId: producer._id,
                                rtpCapabilities: rtpCapabilities,
                                paused: true
                            });
                            log("Created consumer and consumer is: " + (consumer.paused ? "paused" : "running"));
                            localConsumers[consumer.id] = consumer;
                            return res.status(200).send({
                                id: consumer.id,
                                producerId: consumer.producerId,
                                kind: consumer.kind,
                                rtpParameters: consumer.rtpParameters,
                                paused: consumer.paused,
                                type: consumer.type
                            });
                        }
                    } else {
                        // The producer is on another router, so...
                        // first create tansports to it, if not available already


                        //TODO: Create consumer on target router and consume it, forwarding to the producer
                    }
                } else {
                    warn('Could not find producer: ' + globalProducerId);
                    return res.status(404).send({error: "Could not find producer"});
                }
            })
    });

    app.post(RouterPostUrls.PauseConsumer, (req, res) => {
        logRequest(RouterPostUrls.PauseConsumer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {id} = req.body;
        if (!id) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const consumer: Consumer = localConsumers[id];
        if (consumer) {
            return consumer.pause().then(() => res.status(200).send({}));
        }
        warn('Could not find consumer: ' + id);
        return res.status(404).send("Consumer not found");
    });

    app.post(RouterPostUrls.ResumeConsumer, (req, res) => {
        logRequest(RouterPostUrls.ResumeConsumer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {id} = req.body;
        if (!id) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const consumer: Consumer = localConsumers[id];
        if (consumer) {
            return consumer.resume().then(() => {
                log("Resumed consumer and consumer is: " + (consumer.paused ? "paused" : "running"));
                return res.status(200).send({})
            });
        }
        warn('Could not find consumer: ' + id);
        return res.status(404).send("Consumer not found");
    });

    app.post(RouterPostUrls.CloseConsumer, (req, res) => {
        logRequest(RouterPostUrls.CloseConsumer);
        if (!initialized) {
            return res.status(503).send({error: "Not ready"});
        }
        const {id} = req.body;
        if (!id) {
            warn("Invalid body: " + req.body);
            return res.status(400).send("Bad Request");
        }
        const consumer: Consumer = localConsumers[id];
        if (consumer) {
            consumer.close();
            localConsumers = omit(localConsumers, id);
            return res.status(200).send({});
        }
        warn('Could not find consumer: ' + id);
        return res.status(404).send("Consumer not found");
    });

    return app;
}
