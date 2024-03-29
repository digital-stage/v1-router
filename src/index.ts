import { TeckosClientWithJWT } from 'teckos-client';
import { UWSProvider } from 'teckos';
import * as uWS from 'teckos/uws';
import ITeckosProvider from 'teckos/lib/types/ITeckosProvider';
import debug from 'debug';
import { Router, RouterId } from './model/model.server';
import {
  createInitialRouter, getToken,
} from './util';
import createMediasoupSocket, { MediasoupConfiguration } from './mediasoup';
import RouterList from './RouterList';
import ProducerAPI from './ProducerAPI';
import {
  ANNOUNCED_IP,
  API_URL, DISTRIBUTION_URL, DOMAIN, LISTEN_IP, MEDIASOUP_CONFIG, PORT, ROOT_PATH, USE_DISTRIBUTION,
} from './env';

const info = debug('router:info');
const warn = debug('router:warn');
const error = debug('router:error');

const uws = uWS.App();
const io = new UWSProvider(uws);

uws.get('/beat', (res) => {
  res.end('Boom!');
});

uws.get('/ping', (res) => {
  res
    .writeHeader('Content-Type', 'image/svg+xml')
    .end('<svg height="200" width="580" xmlns="http://www.w3.org/2000/svg">\n'
            + '    <path d="m-1-1h582v402h-582z"/>\n'
            + '    <path d="m223 148.453125h71v65h-71z" stroke="#000" stroke-width="1.5"/>\n'
            + '</svg>');
});

const routerList = new RouterList();

/**
 * Collection initial informations about this router
 * and register with it by the router distribution service
 * @param token valid JWT
 * @param initialRouter
 */
const registerRouter = (
  token: string,
  initialRouter: Partial<Router>,
) => new Promise<Router>(
  (resolve) => {
    // Now use token to establish connection to router distribution service
    const socket = new TeckosClientWithJWT(DISTRIBUTION_URL, {}, token, {
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
      info('Distributor gave acknowledge - starting routing server now');
      resolve(router);
    });

    socket.on('connect', () => {
      info('Connected to distribution server');
    });

    socket.on('reconnected', () => {
      warn('Reconnected to distribution server');
    });

    socket.on('disconnect', () => {
      warn('Disconnected from distribution server');
      error("Exit program to let forever restart - yeah it's a workaround ... ;) ");
      process.exit();
    });

    // Now connect
    socket.connect();
  },
);

/**
 * Start this router
 * @param token valid JWT
 * @param router declaration received from router distribution service
 */
const startRouter = (token: string, router: Router): Promise<ITeckosProvider> => {
  const producerAPI = new ProducerAPI(token);
  const config: MediasoupConfiguration = {
    ...MEDIASOUP_CONFIG,
    webRtcTransport: {
      ...MEDIASOUP_CONFIG.webRtcTransport,
      listenIps: [
        {
          ip: LISTEN_IP || '0.0.0.0',
          announcedIp: ANNOUNCED_IP || router.ipv4,
        },
      ],
    },
  };
  console.log(config);
  return createMediasoupSocket(io, router, routerList, producerAPI, config);
};

const port = PORT ? parseInt(PORT, 10) : 3000;

info(`Using API at ${API_URL}`);

const start = async () => {
  const initialRouter: Omit<Router, '_id' | 'userId'> = await createInitialRouter();
  let router: Router;
  const token = await getToken();
  if (USE_DISTRIBUTION) {
    info(`Using DISTRIBUTION SERVICE at ${DISTRIBUTION_URL}`);
    router = await registerRouter(token, initialRouter);
  } else {
    info('Not using DISTRIBUTION SERVICE');
    router = {
      ...initialRouter,
      _id: 'standalone',
      userId: '',
    };
  }
  await startRouter(token, router);
  await io.listen(parseInt(PORT, 10));
  info(`Listening on ${DOMAIN}:${port}/${ROOT_PATH || ''}`);
};

// First get valid token
info('Starting service');
start()
  .catch((initError) => {
    error(initError);
    process.exit();
  });
