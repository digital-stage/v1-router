import express from "express";
import cors from "cors";
import * as https from "https";
import * as fs from "fs";
import {Router, RouterId} from "./model/model.common";
import pino from "pino";
import expressPino from "express-pino-logger";
import path from "path";
import createMediasoupSocket from "./mediasoup";
import io from 'socket.io-client';
import {createInitialRouter, getToken, ProducerAPI, RouterList} from "./util";
import http from "http";

const config = require("./config");

const logger = pino({level: process.env.LOG_LEVEL || 'info'});

const app = express();
app.use(express.urlencoded({extended: true}));
app.use(cors({origin: true}));
app.options('*', cors());
app.use(express.json());
app.use(expressPino());

let server: https.Server | http.Server = undefined;

function startRouter(token: string, router: Router, routerList: RouterList) {
    const producerAPI = new ProducerAPI(token);
    if (config.useSSL === "true") {
        server = https.createServer({
            key: fs.readFileSync(
                path.resolve(config.sslKey)
            ),
            cert: fs.readFileSync(
                path.resolve(config.sslCrt)
            ),
            ca: process.env.SSL_CA || config.ca ? fs.readFileSync(path.resolve(process.env.SSL_CA || config.ca)) : undefined,
            requestCert: true,
            rejectUnauthorized: false
        }, app);
        return createMediasoupSocket(server, router, routerList, producerAPI)
            .then(() => server.listen(config.listenPort));
    } else {
        server = app.listen(config.listenPort);
        return createMediasoupSocket(server, router, routerList, producerAPI);
    }
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
    })
    .catch(error => logger.error(error));

module.exports = app;
