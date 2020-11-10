import pino from "pino";
import createMediasoupSocket from "./mediasoup";
import {createInitialRouter, getToken, ProducerAPI, RouterList} from "./util";
import {Router, RouterId} from "./model/model.server";
import {TeckosClientWithJWT} from "teckos-node-client";
import {UWSProvider} from "teckos";
import * as uWS from 'uWebSockets.js';
import {config} from "dotenv";

config();

const {ROUTER_DIST_URL, LOG_LEVEL, PORT, DOMAIN, ROOT_PATH, API_URL} = process.env;

const logger = pino({level: LOG_LEVEL || 'info'});


const uws = uWS.App();
const io = new UWSProvider(uws);
let running = true;

uws.get('/beat', function(res) {
  res.end('Boom!');
});

function startRouter(token: string, router: Router, routerList: RouterList) {
  const producerAPI = new ProducerAPI(token);
  return createMediasoupSocket(io, router, routerList, producerAPI);
}

function stopRouter() {
  running = false;
}

async function start() {
  // First get token for this router
  const token = await getToken();

  // Create local router
  const initialRouter: Partial<Router> = await createInitialRouter();

  const routerList = new RouterList();

  // Now use token to establish connection to router distribution service
  const socket = new TeckosClientWithJWT(ROUTER_DIST_URL, token, {
    router: initialRouter
  });

  socket.on('connect', () => {
    logger.info("Connected to distribution server");

    socket.emit("router-added", (router: Router) => {
      routerList.add(router);
    });

    socket.on("router-changed", (change: Partial<Router>) => {
      routerList.update(change);
    });

    socket.on("router-removed", (id: RouterId) => {
      routerList.remove(id);
    });

    socket.on("ready", (router: Router) => {
      // Set global router
      return startRouter(token, router, routerList);
    });
  });

  socket.on("reconnected", () => {
    logger.warn("Reconnected to distribution server");
  })

  socket.on('disconnect', () => {
    logger.warn("Disconnected from distribution server");
    return stopRouter();
  })
}

const port = PORT ? parseInt(PORT, 10) : 4010;
start()
  .then(() => io.listen(port))
  .then(() => {
    logger.info("Running on " + DOMAIN + ":" + port + "/" + (ROOT_PATH ? ROOT_PATH : ""));
    logger.info("Using API at " + API_URL);
    logger.info("Using DISTRIBUTION SERVICE at " + ROUTER_DIST_URL);
  })
  .catch(error => logger.error(error));

module.exports = io;
