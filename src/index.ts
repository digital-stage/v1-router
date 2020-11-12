import pino from 'pino';
import { TeckosClientWithJWT } from 'teckos-node-client';
import { UWSProvider } from 'teckos';
import * as uWS from 'uWebSockets.js';
import { config } from 'dotenv';
import ITeckosProvider from 'teckos/lib/types/ITeckosProvider';
import { Router, RouterId } from './model/model.server';
import {
  createInitialRouter, getToken,
} from './util';
import createMediasoupSocket from './mediasoup';
import RouterList from './RouterList';
import ProducerAPI from './ProducerAPI';

config();
const {
  ROUTER_DIST_URL, LOG_LEVEL, PORT, DOMAIN, ROOT_PATH, API_URL,
} = process.env;

const logger = pino({ level: LOG_LEVEL || 'info' });

const uws = uWS.App();
const io = new UWSProvider(uws);

uws.get('/beat', (res) => {
  res.end('Boom!');
});

const routerList = new RouterList();

/**
 * Collection initial informations about this router
 * and register with it by the router distribution service
 * @param token valid JWT
 */
const registerRouter = (token: string) => createInitialRouter()
  .then((initialRouter) => new Promise<Router>((resolve, reject) => {
    // Now use token to establish connection to router distribution service
    const socket = new TeckosClientWithJWT(ROUTER_DIST_URL, token, {
      router: initialRouter,
    });

    socket.emit('router-added', (router: Router) => {
      routerList.add(router);
    });

    socket.on('router-changed', (change: Partial<Router>) => {
      routerList.update(change);
    });

    socket.on('router-removed', (id: RouterId) => {
      routerList.remove(id);
    });

    socket.on('router-ready', (router: Router) => {
      logger.info('Distributor gave acknowledge - starting routing server now');
      resolve(router);
    });

    socket.on('connect', () => {
      logger.info('Connected to distribution server');
    });

    socket.on('reconnected', () => {
      logger.warn('Reconnected to distribution server');
    });

    socket.on('disconnect', () => {
      logger.warn('Disconnected from distribution server');
      reject(new Error('Distribution server closed connection'));
    });

    // Now connect
    socket.connect();
  }));

/**
 * Start this router
 * @param token valid JWT
 * @param router declaration received from router distribution service
 */
const startRouter = (token: string, router: Router): Promise<ITeckosProvider> => {
  const producerAPI = new ProducerAPI(token);
  return createMediasoupSocket(io, router, routerList, producerAPI);
};

const port = PORT ? parseInt(PORT, 10) : 4010;

logger.info(`Using API at ${API_URL}`);
logger.info(`Using DISTRIBUTION SERVICE at ${ROUTER_DIST_URL}`);

// First get valid token
getToken()
  // Now register this router
  .then((token) => registerRouter(token)
    .then((router) => startRouter(token, router)))
  .then(() => io.listen(parseInt(PORT, 10)))
  .then(() => {
    logger.info(`Listening on ${DOMAIN}:${port}/${ROOT_PATH || ''}`);
  })
  .catch((error) => {
    logger.error(error);
  });
