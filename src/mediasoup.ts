import * as mediasoup from 'mediasoup';
import * as os from 'os';
import { Router as MediasoupRouter } from 'mediasoup/lib/Router';
import { DtlsParameters, WebRtcTransport } from 'mediasoup/lib/WebRtcTransport';
import { PlainTransport } from 'mediasoup/lib/PlainTransport';
import { Producer } from 'mediasoup/lib/Producer';
import omit from 'lodash.omit';
import { Consumer } from 'mediasoup/lib/Consumer';
import debug from 'debug';
import { RtpCapabilities } from 'mediasoup/src/RtpParameters';
import { RtpParameters } from 'mediasoup/lib/RtpParameters';
import ITeckosProvider from 'teckos/lib/types/ITeckosProvider';
import { Router } from './model/model.server';
import { RouterRequests } from './events';
import RouterList from './RouterList';
import ProducerAPI from './ProducerAPI';
import { CONNECTIONS_PER_CPU, USE_DISTRIBUTION } from './env';

const log = debug('router:mediasoup');
const warn = log.extend('warn');
const error = log.extend('error');
const trace = log.extend('trace');

const connectionsPerCpu: number = parseInt(CONNECTIONS_PER_CPU, 10);

export interface MediasoupConfiguration {
  worker: mediasoup.types.WorkerSettings,
  router: mediasoup.types.RouterOptions,
  webRtcTransport: mediasoup.types.WebRtcTransportOptions & {
    maxIncomingBitrate?: number,
    minimumAvailableOutgoingBitrate?: number
  }
}

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
  plain: {},
};

let localProducers: {
  [id: string]: Producer
} = {};

let localConsumers: {
  [id: string]: Consumer
} = {};

const init = async (config: MediasoupConfiguration) => {
  const cpuCount: number = os.cpus().length;

  const results: Promise<MediasoupRouter>[] = [];
  for (let i = 0; i < cpuCount; i += 1) {
    results.push(mediasoup.createWorker({
      logLevel: config.worker.logLevel,
      logTags: config.worker.logTags,
      rtcMinPort: config.worker.rtcMinPort,
      rtcMaxPort: config.worker.rtcMaxPort,
    })
      .then((worker) => worker.createRouter(config.router)));
  }
  return Promise.all(results)
    .then((routers) => {
      if (routers.length === 0) {
        throw new Error('No mediasoup routers available');
      }
      routers.map((router) => mediasoupRouters.push({ router, numConnections: 0 }));
      initialized = true;
    });
};

const getAvailableRouter = (): MediasoupRouter | null => {
  for (let i = 0; i < mediasoupRouters.length; i += 1) {
    if (mediasoupRouters[i].numConnections < connectionsPerCpu) {
      return mediasoupRouters[i].router;
    }
  }
  return null;
};

const createMediasoupSocket = async (
  io: ITeckosProvider,
  router: Router,
  routerList: RouterList,
  producerAPI: ProducerAPI,
  config: MediasoupConfiguration,
): Promise<ITeckosProvider> => init(config)
  .then(() => {
    io.onConnection((socket) => {
      trace(`New client connection: ${socket.id}`);

      let transportIds: {} = {};
      let producerIds: {} = {};
      let consumerIds: {} = {};

      try {
        socket.emit('bla');

        socket.on('HELLO', () => trace('got greeting'));

        socket.on(RouterRequests.GetRTPCapabilities,
          (payload: {}, callback: (error: string, rtpCapabilities?: RtpCapabilities) => void) => {
            trace(RouterRequests.GetRTPCapabilities);
            if (!initialized) {
              error('Router is not ready yet');
              return callback('Router is not ready yet');
            }
            trace('Sending RTP Capabilities to client');
            return callback(undefined, mediasoupRouters[0].router.rtpCapabilities);
          });

        socket.on(RouterRequests.CreateTransport,
          (payload: {}, callback: (error: string | null, transportOptions?: any) => void) => {
            trace(RouterRequests.CreateTransport);
            if (!initialized) {
              error('Router is not ready yet');
              return callback('Router is not ready yet');
            }
            const createdRouter: MediasoupRouter | null = getAvailableRouter();
            if (!createdRouter) {
              error('Router is full');
              return callback('Router is full');
            }
            return createdRouter.createWebRtcTransport({
              preferTcp: false,
              listenIps: config.webRtcTransport.listenIps,
              enableUdp: true,
              enableTcp: true,
              preferUdp: true,
              initialAvailableOutgoingBitrate:
                            config.webRtcTransport.initialAvailableOutgoingBitrate,
            }).then((transport: WebRtcTransport) => {
              transports.webrtc[transport.id] = transport;
              transportIds[transport.id] = true;

              callback(null, {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
                sctpParameters: transport.sctpParameters,
                appData: transport.appData,
              });
            }).catch((err) => {
              error(err);
              return callback('Internal server error');
            });
          });

        socket.on(RouterRequests.ConnectTransport, (payload: {
          transportId: string;
          dtlsParameters: DtlsParameters;
        }, callback: (error: string | null) => void) => {
          trace(RouterRequests.ConnectTransport);
          if (!initialized) {
            error('Router is not ready yet');
            return callback('Router is not ready yet');
          }
          const webRtcTransport: WebRtcTransport = transports.webrtc[payload.transportId];
          if (webRtcTransport) {
            return webRtcTransport.connect({ dtlsParameters: payload.dtlsParameters }).then(
              () => callback(null),
            ).catch((connectionError) => {
              warn(connectionError);
              return callback('Internal server error');
            });
          }
          warn(`Could not find transport: ${payload.transportId}`);
          return callback('Internal server error');
        });

        socket.on(RouterRequests.CloseTransport, (payload: {
          transportId: string;
          dtlsParameters: DtlsParameters;
        }, callback: (error?: string) => void) => {
          trace(RouterRequests.ConnectTransport);
          if (!initialized) {
            error('Router is not ready yet');
            return callback('Router is not ready yet');
          }
          const webRtcTransport: WebRtcTransport = transports.webrtc[payload.transportId];
          if (webRtcTransport) {
            webRtcTransport.close();
            transports.webrtc = omit(transports.webrtc, payload.transportId);
            delete transportIds[webRtcTransport.id];
            return callback();
          }
          warn(`Could not find transport: ${payload.transportId}`);
          return callback('Could not find transport');
        });

        socket.on(RouterRequests.CreateProducer, (payload: {
          transportId: string;
          kind: 'audio' | 'video';
          rtpParameters: RtpParameters;
        }, callback: (error: string | null, payload?: { id: string }) => void) => {
          trace(RouterRequests.CreateProducer);
          if (!initialized) {
            error('Router is not ready yet');
            return callback('Router is not ready yet');
          }
          const transport: any = transports.webrtc[payload.transportId];
          if (!transport) {
            warn(`Could not find transport: ${payload.transportId}`);
            return callback('Could not find transport');
          }
          return transport.produce({
            kind: payload.kind,
            rtpParameters: payload.rtpParameters,
          })
            .then((producer: Producer) => {
              producer.on('close', () => {
                trace(`producer closed: ${producer.id}`);
              });
              producer.on('transportclose', () => {
                trace(`transport closed so producer closed: ${producer.id}`);
              });
              trace(`Created ${payload.kind} producer ${producer.id} and producer is: ${producer.paused ? 'paused' : 'running'}`);
              localProducers[producer.id] = producer;
              producerIds[producer.id] = true;
              return callback(null, {
                id: producer.id,
              });
            });
        });

        socket.on(RouterRequests.PauseProducer,
          (id: string, callback: (error: string | null) => void) => {
            trace(RouterRequests.PauseProducer);
            if (!initialized) {
              error('Router is not ready yet');
              return callback('Router is not ready yet');
            }
            const producer: Producer = localProducers[id];
            if (producer) {
              trace(`Pausing ${producer.kind} producer ${id}`);
              return producer.pause()
                .then(() => callback(null));
            }
            warn(`Could not find producer: ${id}`);
            return callback('Producer not found');
          });

        socket.on(RouterRequests.ResumeProducer,
          (id: string, callback: (error: string | null) => void) => {
            trace(RouterRequests.ResumeProducer);
            if (!initialized) {
              error('Router is not ready yet');
              return callback('Router is not ready yet');
            }
            const producer: Producer = localProducers[id];
            if (producer) {
              trace(`Resuming ${producer.kind} producer ${id}`);
              return producer.resume()
                .then(() => callback(null));
            }
            warn(`Could not find producer: ${id}`);
            return callback('Producer not found');
          });

        socket.on(RouterRequests.CloseProducer,
          (id: string, callback: (error: string | null) => void) => {
            trace(RouterRequests.CloseProducer);
            if (!initialized) {
              error('Router is not ready yet');
              return callback('Router is not ready yet');
            }
            const producer: Producer = localProducers[id];
            if (producer) {
              trace(`Closing ${producer.kind} producer ${id}`);
              producer.close();
              localProducers = omit(localProducers, producer.id);
              delete producerIds[producer.id];
              return callback(null);
            }
            warn(`Could not find producer: ${id}`);
            return callback('Producer not found');
          });

        socket.on(RouterRequests.CreateConsumer, (payload: {
          transportId: string;
          globalProducerId: string;
          rtpCapabilities: RtpCapabilities;
        }, callback: (error: string | null, consumer?: any) => void) => {
          trace(RouterRequests.CreateConsumer);
          if (!initialized) {
            error('Router is not ready yet');
            return callback('Router is not ready yet');
          }
          return producerAPI.getProducer(payload.globalProducerId)
            .then(async (producer) => {
              if (producer) {
                if (!USE_DISTRIBUTION || producer.routerId === router._id) {
                  // This is the right router
                  if (localProducers[producer.routerProducerId]) {
                    const transport: WebRtcTransport = transports.webrtc[payload.transportId];
                    if (!transport) {
                      return callback('Transport not found');
                    }
                    const consumer: Consumer = await transport.consume({
                      producerId: producer.routerProducerId,
                      rtpCapabilities: payload.rtpCapabilities,
                      paused: true,
                    });
                    consumer.observer.on('close', () => {
                      trace(`consumer closed: ${consumer.id}`);
                    });
                    trace(`Created consumer ${consumer.id} for producer ${producer.routerProducerId} and consumer is: ${consumer.paused ? 'paused' : 'running'}`);
                    localConsumers[consumer.id] = consumer;
                    consumerIds[consumer.id] = true;
                    return callback(null, {
                      id: consumer.id,
                      producerId: consumer.producerId,
                      kind: consumer.kind,
                      rtpParameters: consumer.rtpParameters,
                      paused: consumer.paused,
                      type: consumer.type,
                    });
                  }
                  warn(`Could not find producer on this router: ${payload.globalProducerId}`);
                  return callback('Producer not found');
                }
                trace('Stream is on different router');
                // The producer is on another router, so...
                // first create tansports to it, if not available already

                // TODO: Create consumer on target router and consume it, forwarding to the producer
                return callback('Router not found');
              }
              warn(`Could not find producer in the database: ${payload.globalProducerId}`);
              return callback('Producer not found');
            })
            .catch((missingProducerError) => {
              error(missingProducerError);
              return callback(missingProducerError);
            });
        });

        socket.on(RouterRequests.PauseConsumer,
          (id: string, callback: (error: string | null) => void) => {
            trace(RouterRequests.PauseConsumer);
            if (!initialized) {
              error('Router is not ready yet');
              return callback('Router is not ready yet');
            }
            const consumer: Consumer = localConsumers[id];
            if (consumer) {
              trace(`Pausing consuer ${consumer.id}`);
              return consumer.pause().then(() => callback(null));
            }
            warn(`Could not find consumer: ${id}`);
            return callback('Consumer not found');
          });

        socket.on(RouterRequests.ResumeConsumer,
          (id: string, callback: (error: string | null) => void) => {
            trace(RouterRequests.ResumeConsumer);
            if (!initialized) {
              error('Router is not ready yet');
              return callback('Router is not ready yet');
            }
            const consumer: Consumer = localConsumers[id];
            if (consumer) {
              trace(`Resuming consumer ${consumer.id}`);
              return consumer.resume().then(() => callback(null));
            }
            warn(`Could not find consumer: ${id}`);
            return callback('Consumer not found');
          });

        socket.on(RouterRequests.CloseConsumer,
          (id: string, callback: (error: string | null) => void) => {
            trace(RouterRequests.CloseConsumer);
            if (!initialized) {
              error('Router is not ready yet');
              return callback('Router is not ready yet');
            }
            const consumer: Consumer = localConsumers[id];
            if (consumer) {
              trace(`Closing consuer ${consumer.id}`);
              consumer.close();
              localConsumers = omit(localConsumers, id);
              delete consumerIds[consumer.id];
              return callback(null);
            }
            warn(`Could not find consumer: ${id}`);
            return callback('Consumer not found');
          });

        socket.on('disconnect', () => {
          trace('Client disconnected, cleaning up');
          Object.keys(consumerIds).forEach((key) => {
            if (consumerIds[key]) {
              trace(`Removing consumer ${key}`);
              localConsumers[key].close();
              delete localConsumers[key];
            }
          });
          consumerIds = {};
          Object.keys(producerIds).forEach((key) => {
            if (producerIds[key]) {
              trace(`Removing producer ${key}`);
              localProducers[key].close();
              delete localProducers[key];
            }
          });
          producerIds = {};
          Object.keys(transportIds).forEach((key) => {
            if (transportIds[key]) {
              trace(`Removing transport ${key}`);
              transports.webrtc[key].close();
              delete transports.webrtc[key];
            }
          });
          transportIds = {};
        });
      } catch (socketError) {
        socket.disconnect();
        error(socketError);
      }
    });

    return io;
  });
export default createMediasoupSocket;
