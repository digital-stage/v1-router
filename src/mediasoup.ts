import * as mediasoup from 'mediasoup';
import * as os from 'os';
import { Router as MediasoupRouter } from 'mediasoup/lib/Router';
import { DtlsParameters, WebRtcTransport } from 'mediasoup/lib/WebRtcTransport';
import { PlainTransport } from 'mediasoup/lib/PlainTransport';
import { Producer } from 'mediasoup/lib/Producer';
import omit from 'lodash.omit';
import { Consumer } from 'mediasoup/lib/Consumer';
import pino from 'pino';
import { RtpCapabilities } from 'mediasoup/src/RtpParameters';
import { RtpParameters } from 'mediasoup/lib/RtpParameters';
import ITeckosProvider from 'teckos/lib/types/ITeckosProvider';
import { config } from 'dotenv';
import { Router } from './model/model.server';
import { RouterRequests } from './events';
import RouterList from './RouterList';
import ProducerAPI from './ProducerAPI';

config();

const { CONNECTIONS_PER_CPU } = process.env;

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const mediasoupConfig = require('./config');

const connectionsPerCpu: number = parseInt(CONNECTIONS_PER_CPU, 10);

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

const init = async () => {
  const cpuCount: number = os.cpus().length;
  const { mediaCodecs } = mediasoupConfig.router;

  const results = [];
  for (let i = 0; i < cpuCount; i += 1) {
    results.push(() => mediasoup.createWorker({
      logLevel: mediasoupConfig.worker.logLevel,
      logTags: mediasoupConfig.worker.logTags,
      rtcMinPort: mediasoupConfig.worker.rtcMinPort,
      rtcMaxPort: mediasoupConfig.worker.rtcMaxPort,
    })
      .then((worker) => worker.createRouter({ mediaCodecs }))
      .then((router) => {
        mediasoupRouters.push({ router, numConnections: 0 });
      }));
  }
  await Promise.all(results);
  initialized = true;
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
): Promise<ITeckosProvider> => {
  await init();

  io.onConnection((socket) => {
    logger.trace(`New client connection: ${socket.id}`);
    let transportIds: {} = {};
    let producerIds: {} = {};
    let consumerIds: {} = {};

    socket.on('HELLO', () => logger.trace('got greeting'));

    socket.on(RouterRequests.GetRTPCapabilities,
      (payload: {}, callback: (error: string, rtpCapabilities?: RtpCapabilities) => void) => {
        logger.info('HEEY');
        logger.trace(RouterRequests.GetRTPCapabilities);
        if (!initialized) {
          logger.error('Router is not ready yet');
          return callback('Router is not ready yet');
        }
        logger.trace('Sending RTP Capabilities to client');
        return callback(undefined, mediasoupRouters[0].router.rtpCapabilities);
      });

    socket.on(RouterRequests.CreateTransport,
      (payload: {}, callback: (error: string | null, transportOptions?: any) => void) => {
        logger.trace(RouterRequests.CreateTransport);
        if (!initialized) {
          logger.error('Router is not ready yet');
          return callback('Router is not ready yet');
        }
        const createdRouter: MediasoupRouter | null = getAvailableRouter();
        if (!createdRouter) {
          logger.error('Router is full');
          return callback('Router is full');
        }
        return createdRouter.createWebRtcTransport({
          preferTcp: false,
          listenIps: mediasoupConfig.webRtcTransport.listenIps,
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
          initialAvailableOutgoingBitrate:
        mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
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
          logger.error(err);
          return callback('Internal server error');
        });
      });

    socket.on(RouterRequests.ConnectTransport, (payload: {
      transportId: string;
      dtlsParameters: DtlsParameters;
    }, callback: (error: string | null) => void) => {
      logger.trace(RouterRequests.ConnectTransport);
      if (!initialized) {
        logger.error('Router is not ready yet');
        return callback('Router is not ready yet');
      }
      const webRtcTransport: WebRtcTransport = transports.webrtc[payload.transportId];
      if (webRtcTransport) {
        return webRtcTransport.connect({ dtlsParameters: payload.dtlsParameters }).then(
          () => callback(null),
        ).catch((error) => {
          logger.warn(error);
          return callback('Internal server error');
        });
      }
      logger.warn(`Could not find transport: ${payload.transportId}`);
      return callback('Internal server error');
    });

    socket.on(RouterRequests.CloseTransport, (payload: {
      transportId: string;
      dtlsParameters: DtlsParameters;
    }, callback: (error?: string) => void) => {
      logger.trace(RouterRequests.ConnectTransport);
      if (!initialized) {
        logger.error('Router is not ready yet');
        return callback('Router is not ready yet');
      }
      const webRtcTransport: WebRtcTransport = transports.webrtc[payload.transportId];
      if (webRtcTransport) {
        webRtcTransport.close();
        transports.webrtc = omit(transports.webrtc, payload.transportId);
        delete transportIds[webRtcTransport.id];
        return callback();
      }
      logger.warn(`Could not find transport: ${payload.transportId}`);
      return callback('Could not find transport');
    });

    socket.on(RouterRequests.CreateProducer, (payload: {
      transportId: string;
      kind: 'audio' | 'video';
      rtpParameters: RtpParameters;
    }, callback: (error: string | null, payload?: { id: string }) => void) => {
      logger.trace(RouterRequests.CreateProducer);
      if (!initialized) {
        logger.error('Router is not ready yet');
        return callback('Router is not ready yet');
      }
      const transport: any = transports.webrtc[payload.transportId];
      if (!transport) {
        logger.warn(`Could not find transport: ${payload.transportId}`);
        return callback('Could not find transport');
      }
      return transport.produce({
        kind: payload.kind,
        rtpParameters: payload.rtpParameters,
      })
        .then((producer: Producer) => {
          producer.on('close', () => {
            logger.trace(`producer closed: ${producer.id}`);
          });
          producer.on('transportclose', () => {
            logger.trace(`transport closed so producer closed: ${producer.id}`);
          });
          logger.debug(`Created producer ${producer.id} and producer is: ${producer.paused ? 'paused' : 'running'}`);
          localProducers[producer.id] = producer;
          producerIds[producer.id] = true;
          return callback(null, {
            id: producer.id,
          });
        });
    });

    socket.on(RouterRequests.PauseProducer,
      (id: string, callback: (error: string | null) => void) => {
        logger.trace(RouterRequests.PauseProducer);
        if (!initialized) {
          logger.error('Router is not ready yet');
          return callback('Router is not ready yet');
        }
        const producer: Producer = localProducers[id];
        if (producer) {
          return producer.pause()
            .then(() => callback(null));
        }
        logger.warn(`Could not find producer: ${id}`);
        return callback('Producer not found');
      });

    socket.on(RouterRequests.ResumeProducer,
      (id: string, callback: (error: string | null) => void) => {
        logger.trace(RouterRequests.ResumeProducer);
        if (!initialized) {
          logger.error('Router is not ready yet');
          return callback('Router is not ready yet');
        }
        const producer: Producer = localProducers[id];
        if (producer) {
          return producer.resume()
            .then(() => callback(null));
        }
        logger.warn(`Could not find producer: ${id}`);
        return callback('Producer not found');
      });

    socket.on(RouterRequests.CloseProducer,
      (id: string, callback: (error: string | null) => void) => {
        logger.trace(RouterRequests.CloseProducer);
        if (!initialized) {
          logger.error('Router is not ready yet');
          return callback('Router is not ready yet');
        }
        const producer: Producer = localProducers[id];
        if (producer) {
          producer.close();
          localProducers = omit(localProducers, producer.id);
          delete producerIds[producer.id];
          return callback(null);
        }
        logger.warn(`Could not find producer: ${id}`);
        return callback('Producer not found');
      });

    socket.on(RouterRequests.CreateConsumer, (payload: {
      transportId: string;
      globalProducerId: string;
      rtpCapabilities: RtpCapabilities;
    }, callback: (error: string | null, consumer?: any) => void) => {
      logger.trace(RouterRequests.CreateConsumer);
      if (!initialized) {
        logger.error('Router is not ready yet');
        return callback('Router is not ready yet');
      }
      return producerAPI.getProducer(payload.globalProducerId)
        .then(async (producer) => {
          logger.trace('fetched!');
          if (producer) {
            logger.trace('Got valid producer');
            if (producer.routerId === router._id) {
              logger.trace('This is the right router');
              // This is the right router
              if (localProducers[producer.routerProducerId]) {
                logger.trace('Found assigned producer');
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
                  logger.trace(`consumer closed: ${consumer.id}`);
                });
                logger.debug(`Created consumer and consumer is: ${consumer.paused ? 'paused' : 'running'}`);
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
              logger.warn(`Could not find producer on this router: ${payload.globalProducerId}`);
              return callback('Producer not found');
            }
            logger.trace('Stream is on different router');
            // The producer is on another router, so...
            // first create tansports to it, if not available already

            // TODO: Create consumer on target router and consume it, forwarding to the producer
            return callback('Router not found');
          }
          logger.warn(`Could not find producer in the database: ${payload.globalProducerId}`);
          return callback('Producer not found');
        })
        .catch((error) => {
          logger.error(error);
          return callback(error);
        });
    });

    socket.on(RouterRequests.PauseConsumer,
      (id: string, callback: (error: string | null) => void) => {
        logger.trace(RouterRequests.PauseConsumer);
        if (!initialized) {
          logger.error('Router is not ready yet');
          return callback('Router is not ready yet');
        }
        const consumer: Consumer = localConsumers[id];
        if (consumer) {
          return consumer.pause().then(() => callback(null));
        }
        logger.warn(`Could not find consumer: ${id}`);
        return callback('Consumer not found');
      });

    socket.on(RouterRequests.ResumeConsumer,
      (id: string, callback: (error: string | null) => void) => {
        logger.trace(RouterRequests.ResumeConsumer);
        if (!initialized) {
          logger.error('Router is not ready yet');
          return callback('Router is not ready yet');
        }
        const consumer: Consumer = localConsumers[id];
        if (consumer) {
          return consumer.resume().then(() => callback(null));
        }
        logger.warn(`Could not find consumer: ${id}`);
        return callback('Consumer not found');
      });

    socket.on(RouterRequests.CloseConsumer,
      (id: string, callback: (error: string | null) => void) => {
        logger.trace(RouterRequests.CloseConsumer);
        if (!initialized) {
          logger.error('Router is not ready yet');
          return callback('Router is not ready yet');
        }
        const consumer: Consumer = localConsumers[id];
        if (consumer) {
          consumer.close();
          localConsumers = omit(localConsumers, id);
          delete consumerIds[consumer.id];
          return callback(null);
        }
        logger.warn(`Could not find consumer: ${id}`);
        return callback('Consumer not found');
      });

    socket.on('disconnect', () => {
      logger.debug('Client disconnected, cleaning up');
      Object.keys(consumerIds).forEach((key) => {
        if (consumerIds[key]) {
          logger.debug(`Removing consumer ${key}`);
          localConsumers[key].close();
          delete localConsumers[key];
        }
      });
      consumerIds = {};
      Object.keys(producerIds).forEach((key) => {
        if (producerIds[key]) {
          logger.debug(`Removing producer ${key}`);
          localProducers[key].close();
          delete localProducers[key];
        }
      });
      producerIds = {};
      Object.keys(transportIds).forEach((key) => {
        if (transportIds[key]) {
          logger.debug(`Removing transport ${key}`);
          transports.webrtc[key].close();
          delete transports.webrtc[key];
        }
      });
      transportIds = {};
      logger.trace('Transports are now: ');
      logger.trace(transports);
    });
  });

  return io;
};
export default createMediasoupSocket;
