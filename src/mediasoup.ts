import { Injectable } from '@hacker-und-koch/di';
import { Logger } from '@hacker-und-koch/logger';

import * as express from "express";
import * as firebase from 'firebase';
// @ts-ignore
import * as omit from 'lodash.omit';
import * as mediasoup from 'mediasoup';
import { Consumer } from 'mediasoup/lib/Consumer';
import { PlainTransport } from 'mediasoup/lib/PlainTransport';
import { Producer } from 'mediasoup/lib/Producer';
import { Router } from 'mediasoup/lib/Router';
import { WebRtcTransport } from 'mediasoup/lib/WebRtcTransport';
import { Worker } from 'mediasoup/lib/Worker';

import { RouterGetUrls, RouterPostUrls } from './events';
import { DatabaseGlobalProducer, DatabaseProducer } from './model';
import { HardwareInfo, Database } from './services';

import config from './config';

//TODO: Export verify token into cloud functions and use only realtime database client instead of admin sdk

export type Dict<T> = { [id: string]: T };
export interface RouterInfo { router: Router, numConnections: number };
export interface TransporterInfo { webrtc: Dict<WebRtcTransport>, plain: Dict<PlainTransport> };

@Injectable()
export class Mediasoup {
    initialized: boolean = false;

    router: RouterInfo[] = [];
    transports: TransporterInfo = { webrtc: {}, plain: {} };
    localProducers: Dict<Producer> = {};
    localConsumers: Dict<Consumer> = {};
    forwardConsumers: Dict<Consumer> = {};

    constructor(
        private db: Database,
        private hw: HardwareInfo,
        private logger: Logger,
    ) { }

    async onInit() {
        for (let i = 0; i < this.hw.cpuCount; i++) {
            const worker: Worker = await mediasoup.createWorker(config.mediasoup.worker);
            const workerRouter: Router = await worker.createRouter(config.mediasoup.router);

            this.router.push({
                router: workerRouter,
                numConnections: 0
            });
        }
    }

    onReady() {
        this.initialized = true;
    }

    getAvailableRouter(): Router {
        const availableRouter = this.router.find(r => r.numConnections < config.mediasoup.connectionsPerCpu);
        return availableRouter ? availableRouter.router : undefined;
    };


    get expressRouter() {
        const app = express.Router();
        app.use(express.json());

        app.use((req, res, next) => {
            if (!this.initialized) {
                return res.status(501)
                    .send({ error: "Not ready yet" });
            }
            next();
        });

        app.get("/", (req, res, next) => {
            return res.status(200)
                .send(`Alive and kick'n with ${this.router.length} cores!`);
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
            res.status(200).send(
                this.router[0]
                    .router.rtpCapabilities
            );
        });

        /***
         * /transport/webrtc
         */
        app.get(RouterGetUrls.CreateTransport, (req, res, next) => {
            const router: Router = this.getAvailableRouter();
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
                this.transports.webrtc[transport.id] = transport;

                return res.status(200)
                    .send({
                        id: transport.id,
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                        sctpParameters: transport.sctpParameters,
                        appData: transport.appData
                    });
            }).catch((error) => {
                this.logger.error(error);
                return res.status(500)
                    .send({
                        error: "Internal server error"
                    });
            });
        });
        app.post(RouterPostUrls.ConnectTransport, (req, res, next) => {
            const { transportId, dtlsParameters } = req.body;

            if (!transportId || !dtlsParameters) {
                this.logger.warn("Invalid body: " + req.body);
                console.log(req.body);
                return res.status(400).send({ error: "Bad Request" });
            }

            const webRtcTransport: WebRtcTransport = this.transports.webrtc[transportId];
            if (webRtcTransport) {
                return webRtcTransport.connect({ dtlsParameters: dtlsParameters }).then(
                    () => res.status(200).send({ success: true })
                ).catch((error) => {
                    this.logger.error(error);
                    return res.status(500).send({ error: "Internal server error" });
                });
            }
            return res.status(400).send({ error: "Not found" });
        });
        app.post(RouterPostUrls.CloseTransport, (req, res, next) => {
            const { transportId, dtlsParameters } = req.body;
            if (!transportId || !dtlsParameters) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const webRtcTransport: WebRtcTransport = this.transports.webrtc[transportId];
            if (webRtcTransport) {
                webRtcTransport.close();
                this.transports.webrtc = omit(this.transports.webrtc, transportId);
                return res.status(200).send({ success: true });
            }
            return res.status(400).send({ error: "Not found" });
        });


        /***
         * /transport/plain
         */
        app.get(RouterGetUrls.CreatePlainTransport, (req, res, next) => {
            const router: Router | null = this.getAvailableRouter();
            if (!router) {
                return res.status(509).send("Full");
            }
            return router.createPlainTransport({
                listenIp: this.hw.ip6,
                rtcpMux: true,
                comedia: true
            }).then((transport: PlainTransport) => {
                this.transports.plain[transport.id] = transport;
                return res.status(200).send(JSON.stringify({
                    id: transport.id,
                    sctpParameters: transport.sctpParameters,
                    appData: transport.appData
                }));
            }).catch((error) => {
                this.logger.error(error);
                return res.status(500).send({ error: "Internal server error" });
            });
        });
        app.post(RouterPostUrls.ConnectPlainTransport, (req, res, next) => {
            const { transportId, ip, port, rtcpPort, srtpParameters } = req.body;
            if (!transportId || !ip || !port || !rtcpPort || !srtpParameters) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const plainTransport: PlainTransport = this.transports.plain[transportId];
            if (plainTransport) {
                return plainTransport.connect({
                    ip: ip,
                    port: port,
                    rtcpPort: rtcpPort,
                    srtpParameters: srtpParameters,
                }).then(
                    () => res.status(200).send({ success: true })
                ).catch((error) => {
                    this.logger.error(error);
                    return res.status(500).send({ error: "Internal server error" });
                });
            }
        });

        app.post(RouterPostUrls.ClosePlainTransport, (req, res, next) => {
            const { transportId, dtlsParameters } = req.body;
            if (!transportId || !dtlsParameters) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const plainTransport: PlainTransport = this.transports.plain[transportId];
            if (plainTransport) {
                plainTransport.close();
                this.transports.plain = omit(this.transports.plain, transportId);
                return res.status(200).send({ success: true });
            }
            return res.status(400).send({ error: "Not found" });
        });


        /***
         *
         */
        app.post(RouterPostUrls.CreateProducer, (req, res) => {
            const { transportId, kind, rtpParameters } = req.body;
            if (!transportId || !kind || !rtpParameters) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const transport: WebRtcTransport = this.transports.webrtc[transportId];
            if (!transport) {
                return res.status(404).send({ error: "Transport not found" });
            }
            return transport.produce({
                kind: kind,
                rtpParameters: rtpParameters
            })
                .then((producer: Producer) => {
                    producer.on("transportclose", () => {
                        this.logger.log("producer's transport closed", producer.id);
                    });
                    this.logger.log("Created producer and producer is: " + producer.paused);
                    this.localProducers[producer.id] = producer;
                    return res.status(200)
                        .send({ id: producer.id });
                });
        });

        app.post(RouterPostUrls.PauseProducer, (req, res) => {
            if (!req.headers.authorization) {
                return res.status(511).send({ error: "Authentication Required" });
            }
            const { id } = req.body;
            if (!id) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const producer: Producer = this.localProducers[id];
            if (producer) {
                return producer.pause().then(() => res.status(200).send({ success: true }));
            }

            return res.status(404).send({ error: "Transport not found" });
        });

        app.post(RouterPostUrls.ResumeProducer, (req, res) => {
            const { id } = req.body;
            if (!id) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const producer: Producer = this.localProducers[id];
            if (producer) {
                return producer.resume().then(() => res.status(200).send({ success: true }));
            }
            return res.status(404).send({ error: "Producer not found" });
        });

        app.post(RouterPostUrls.CloseProducer, (req, res) => {
            const { id } = req.body;
            if (!id) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const producer: Producer = this.localProducers[id];
            if (producer) {
                producer.close();
                return res.status(200).send({ success: true });
            }
            return res.status(404).send({ error: "Producer not found" });
        });

        app.post(RouterPostUrls.CreateConsumer, (req, res) => {
            const { transportId, globalProducerId, rtpCapabilities } = req.body;
            if (!transportId || !globalProducerId || !rtpCapabilities) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            return firebase.firestore()
                .collection("producers")
                .doc(globalProducerId)
                .get()
                .then(async (snapshot: firebase.firestore.DocumentSnapshot) => {
                    if (snapshot.exists) {
                        const globalProducer: DatabaseGlobalProducer = snapshot.data() as DatabaseGlobalProducer;
                        if (globalProducer.routerId === this.db.routerId) {
                            // This is the right router
                            if (this.localProducers[globalProducer.producerId]) {
                                const transport: WebRtcTransport = this.transports.webrtc[transportId];
                                if (!transport) {
                                    return res.status(400).send({ error: "Transport not found" });
                                }
                                const consumer: Consumer = await transport.consume({
                                    producerId: globalProducer.producerId,
                                    rtpCapabilities: rtpCapabilities,
                                    paused: true
                                });
                                this.logger.log("Created consumer and consumer is: " + consumer.paused);
                                this.localConsumers[consumer.id] = consumer;
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
                    }
                    return res.status(404).send({ error: "Could not find producer" });
                });
        });

        app.post(RouterPostUrls.PauseConsumer, (req, res) => {
            const { id } = req.body;
            if (!id) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const consumer: Consumer = this.localConsumers[id];
            if (consumer) {
                return consumer.pause().then(() => res.status(200).send({ success: true }));
            }
            return res.status(404).send({ error: "Consumer not found" });
        });

        app.post(RouterPostUrls.ResumeConsumer, (req, res) => {
            const { id } = req.body;
            if (!id) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const consumer: Consumer = this.localConsumers[id];
            if (consumer) {
                return consumer.resume().then(() => {
                    this.logger.log("Resumed consumer and consumer is: " + consumer.paused);
                    return res.status(200).send({ success: true })
                });
            }
            return res.status(404).send({ error: "Consumer not found" });
        });

        app.post(RouterPostUrls.CloseConsumer, (req, res) => {
            const { id } = req.body;
            if (!id) {
                this.logger.warn("Invalid body: " + req.body);
                return res.status(400).send({ error: "Bad Request" });
            }
            const consumer: Consumer = this.localConsumers[id];
            if (consumer) {
                consumer.close();
                this.localConsumers = omit(this.localConsumers, id);
                return res.status(200).send({ success: true });
            }
            return res.status(404).send({ error: "Consumer not found" });
        });

        return app;
    }
}
