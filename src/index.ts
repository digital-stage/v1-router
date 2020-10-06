import express from "express";
import cors from "cors";
import pino from "pino";
import expressPino from "express-pino-logger";
import createMediasoupSocket from "./mediasoup";
import io from 'socket.io-client';
import {createInitialRouter, getToken, ProducerAPI, RouterList} from "./util";
import {Router, RouterId} from "./model/model.server";

const config = require("./config");

const logger = pino({level: process.env.LOG_LEVEL || 'info'});

const app = express();
app.use(express.urlencoded({extended: true}));
app.use(cors({origin: true}));
app.options('*', cors());
app.use(express.json());
app.use(expressPino());

app.get('/beat', function (req, res) {
    res.send('Boom!');
});

const server = app.listen(config.listenPort);

function startRouter(token: string, router: Router, routerList: RouterList) {
    const producerAPI = new ProducerAPI(token);
    return createMediasoupSocket(server, router, routerList, producerAPI);
}

function stopRouter() {
    if (server)
        server.close();
}

async function start() {
    // First get token for this router
    const token = await getToken();

    // Create local router
    const initialRouter: Partial<Router> = await createInitialRouter();

    const routerList = new RouterList();

    // Now use token to establish connection to router distribution service
    const socket = io(config.router_dist_url, {
        query: {
            token,
            router: JSON.stringify(initialRouter)
        }
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

start()
    .then(() => {
        logger.info("Running on " + (config.useSSL === "true" ? "https://" : "http://") + config.domain + ":" + config.listenPort);
        logger.info("Using API at " + config.api_url);
    })
    .catch(error => logger.error(error));

module.exports = app;
