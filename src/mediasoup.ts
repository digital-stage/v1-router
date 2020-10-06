import {Worker} from "mediasoup/lib/Worker";
import * as mediasoup from "mediasoup";
import {RouterRequests} from "./events";
import * as os from "os";
import {Router as MediasoupRouter} from "mediasoup/lib/Router";
import {DtlsParameters, WebRtcTransport} from "mediasoup/lib/WebRtcTransport";
import {PlainTransport} from "mediasoup/lib/PlainTransport";
import {Producer} from "mediasoup/lib/Producer";
import omit from "lodash.omit";
import {Consumer} from "mediasoup/lib/Consumer";
import pino from "pino";
import socketIO from "socket.io";
import {RtpCapabilities} from "mediasoup/src/RtpParameters";
import * as https from "https";
import http from "http";
import {RtpParameters} from "mediasoup/lib/RtpParameters";
import {ProducerAPI, RouterList} from "./util";
import {Router} from "./model/model.server";


const logger = pino({level: process.env.LOG_LEVEL || 'info'});

const config = require("./config");
const connectionsPerCpu = 500;

//TODO: Export verify token into cloud functions and use only realtime database client instead of admin sdk

let initialized: boolean = false;

const mediasoupRouters: {
    router: MediasoupRouter,
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
        const workerRouter: MediasoupRouter = await worker.createRouter({mediaCodecs});
        mediasoupRouters.push({router: workerRouter, numConnections: 0});
    }
    initialized = true;
};

const getAvailableRouter = (): MediasoupRouter | null => {
    for (let i = 0; i < mediasoupRouters.length; i++) {
        if (mediasoupRouters[i].numConnections < connectionsPerCpu) {
            return mediasoupRouters[i].router;
        }
    }
    return null;
};

const createMediasoupSocket = async (server: https.Server | http.Server, router: Router, routerList: RouterList, producerAPI: ProducerAPI): Promise<socketIO.Server> => {
    await init();

    const io = socketIO(server);

    io.on("connection", (socket: socketIO.Socket) => {
        let transportIds: {} = {};
        let producerIds: {} = {};
        let consumerIds: {} = {};

        socket.on(RouterRequests.GetRTPCapabilities, (payload: {}, callback: (error: string, rtpCapabilities?: RtpCapabilities) => void) => {
            logger.trace(RouterRequests.GetRTPCapabilities);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            return callback(undefined, mediasoupRouters[0].router.rtpCapabilities);
        });

        socket.on(RouterRequests.CreateTransport, (payload: {}, callback: (error: string | null, transportOptions?: any) => void) => {
            logger.trace(RouterRequests.CreateTransport);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const router: MediasoupRouter | null = getAvailableRouter();
            if (!router) {
                logger.error("Router is full");
                return callback("Router is full");
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
                transportIds[transport.id] = true;

                callback(null, {
                    id: transport.id,
                    iceParameters: transport.iceParameters,
                    iceCandidates: transport.iceCandidates,
                    dtlsParameters: transport.dtlsParameters,
                    sctpParameters: transport.sctpParameters,
                    appData: transport.appData
                });
            }).catch((err) => {
                logger.error(err);
                return callback("Internal server error");
            });
        });

        socket.on(RouterRequests.ConnectTransport, (payload: {
            transportId: string;
            dtlsParameters: DtlsParameters;
        }, callback: (error: string | null) => void) => {
            logger.trace(RouterRequests.ConnectTransport);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const webRtcTransport: WebRtcTransport = transports.webrtc[payload.transportId];
            if (webRtcTransport) {
                return webRtcTransport.connect({dtlsParameters: payload.dtlsParameters}).then(
                    () => callback(null)
                ).catch((error) => {
                    logger.warn(error);
                    return callback("Internal server error");
                });
            }
            logger.warn('Could not find transport: ' + payload.transportId);
            return callback("Internal server error");
        });

        socket.on(RouterRequests.CloseTransport, (payload: {
            transportId: string;
            dtlsParameters: DtlsParameters;
        }, callback: (error?: string) => void) => {
            logger.trace(RouterRequests.ConnectTransport);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const webRtcTransport: WebRtcTransport = transports.webrtc[payload.transportId];
            if (webRtcTransport) {
                webRtcTransport.close();
                transports.webrtc = omit(transports.webrtc, payload.transportId);
                delete transportIds[webRtcTransport.id];
                return callback();
            }
            logger.warn('Could not find transport: ' + payload.transportId);
            return callback("Could not find transport");
        });

        socket.on(RouterRequests.CreateProducer, (payload: {
            transportId: string;
            kind: "audio" | "video";
            rtpParameters: RtpParameters;
        }, callback: (error: string | null, payload?: { id: string }) => void) => {
            logger.trace(RouterRequests.CreateProducer);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const transport: any = transports.webrtc[payload.transportId];
            if (!transport) {
                logger.warn('Could not find transport: ' + payload.transportId);
                return callback("Could not find transport");
            }
            return transport.produce({
                kind: payload.kind,
                rtpParameters: payload.rtpParameters
            })
                .then((producer: Producer) => {
                    producer.on("close", () => {
                        console.log("producer closed: " + producer.id);
                    })
                    producer.on("transportclose", () => {
                        console.log("transport closed so producer closed: " + producer.id);
                    })
                    logger.debug("Created producer " + producer.id + " and producer is: " + (producer.paused ? "paused" : "running"));
                    localProducers[producer.id] = producer;
                    producerIds[producer.id] = true;
                    return callback(null, {
                        id: producer.id
                    });
                });
        });

        socket.on(RouterRequests.PauseProducer, (id: string, callback: (error: string | null) => void) => {
            logger.trace(RouterRequests.PauseProducer);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const producer: Producer = localProducers[id];
            if (producer) {
                return producer.pause()
                    .then(() => callback(null));
            }
            logger.warn('Could not find producer: ' + id);
            callback("Producer not found");
        });

        socket.on(RouterRequests.ResumeProducer, (id: string, callback: (error: string | null) => void) => {
            logger.trace(RouterRequests.ResumeProducer);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const producer: Producer = localProducers[id];
            if (producer) {
                return producer.resume()
                    .then(() => callback(null));
            }
            logger.warn('Could not find producer: ' + id);
            callback("Producer not found");
        });

        socket.on(RouterRequests.CloseProducer, (id: string, callback: (error: string | null) => void) => {
            logger.trace(RouterRequests.CloseProducer);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const producer: Producer = localProducers[id];
            if (producer) {
                producer.close();
                localProducers = omit(localProducers, producer.id);
                delete producerIds[producer.id];
                return callback(null);
            }
            logger.warn('Could not find producer: ' + id);
            callback("Producer not found");
        });

        socket.on(RouterRequests.CreateConsumer, (payload: {
            transportId: string;
            globalProducerId: string;
            rtpCapabilities: RtpCapabilities;
        }, callback: (error: string | null, consumer?: any) => void) => {
            logger.trace(RouterRequests.CreateConsumer);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            return producerAPI.getProducer(payload.globalProducerId)
                .then(async producer => {
                    logger.trace("fetched!");
                    if (producer) {
                        logger.trace("Got valid producer");
                        if (producer.routerId === router._id) {
                            logger.trace("This is the right router");
                            // This is the right router
                            if (localProducers[producer.routerProducerId]) {
                                logger.trace("Found assigned producer");
                                const transport: WebRtcTransport = transports.webrtc[payload.transportId];
                                if (!transport) {
                                    return callback("Transport not found");
                                }
                                const consumer: Consumer = await transport.consume({
                                    producerId: producer.routerProducerId,
                                    rtpCapabilities: payload.rtpCapabilities,
                                    paused: true
                                });
                                consumer.observer.on("close", () => {
                                    console.log("consumer closed: " + consumer.id);
                                })
                                logger.debug("Created consumer and consumer is: " + (consumer.paused ? "paused" : "running"));
                                localConsumers[consumer.id] = consumer;
                                consumerIds[consumer.id] = true;
                                return callback(null, {
                                    id: consumer.id,
                                    producerId: consumer.producerId,
                                    kind: consumer.kind,
                                    rtpParameters: consumer.rtpParameters,
                                    paused: consumer.paused,
                                    type: consumer.type
                                });
                            } else {
                                logger.warn('Could not find producer on this router: ' + payload.globalProducerId);
                                callback("Producer not found");
                            }
                        } else {
                            logger.trace("Stream is on different router");
                            // The producer is on another router, so...
                            // first create tansports to it, if not available already


                            //TODO: Create consumer on target router and consume it, forwarding to the producer
                            callback("Router not found");
                        }
                    } else {
                        logger.warn('Could not find producer in the database: ' + payload.globalProducerId);
                        return callback("Producer not found");
                    }
                })
                .catch(error => {
                    logger.error(error);
                    return callback(error);
                });
        });

        socket.on(RouterRequests.PauseConsumer, (id: string, callback: (error: string | null) => void) => {
            logger.trace(RouterRequests.PauseConsumer);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const consumer: Consumer = localConsumers[id];
            if (consumer) {
                return consumer.pause().then(() => callback(null));
            }
            logger.warn('Could not find consumer: ' + id);
            return callback("Consumer not found");
        });

        socket.on(RouterRequests.ResumeConsumer, (id: string, callback: (error: string | null) => void) => {
            logger.trace(RouterRequests.ResumeConsumer);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const consumer: Consumer = localConsumers[id];
            if (consumer) {
                return consumer.resume().then(() => callback(null));
            }
            logger.warn('Could not find consumer: ' + id);
            return callback("Consumer not found");
        });

        socket.on(RouterRequests.CloseConsumer, (id: string, callback: (error: string | null) => void) => {
            logger.trace(RouterRequests.CloseConsumer);
            if (!initialized) {
                logger.error("Router is not ready yet");
                return callback("Router is not ready yet");
            }
            const consumer: Consumer = localConsumers[id];
            if (consumer) {
                consumer.close();
                localConsumers = omit(localConsumers, id);
                delete consumerIds[consumer.id];
                return callback(null);
            }
            logger.warn('Could not find consumer: ' + id);
            return callback("Consumer not found");
        });

        socket.on("disconnect", () => {
            logger.debug("Client disconnected, cleaning up");
            for (const key in consumerIds) {
                if (consumerIds[key]) {
                    logger.debug("Removing consumer " + key);
                    localConsumers[key].close();
                    delete localConsumers[key];
                }
            }
            consumerIds = {};
            for (const key in producerIds) {
                if (producerIds[key]) {
                    logger.debug("Removing producer " + key);
                    localProducers[key].close();
                    delete localProducers[key];
                }
            }
            producerIds = {};
            for (const key in transportIds) {
                if (transportIds[key]) {
                    logger.debug("Removing transport " + key);
                    transports.webrtc[key].close();
                    delete transports.webrtc[key];
                }
            }
            transportIds = {};
            console.log("Transports are now: ");
            console.log(transports);
        })

    });

    return io;
}
export default createMediasoupSocket;