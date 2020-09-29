import express from "express";
import cors from "cors";
import * as https from "https";
import * as publicIp from "public-ip";
import * as fs from "fs";
import {Producer, Router} from "./model/model.common";
import fetch from "node-fetch";
import pino from "pino";
import expressPino from "express-pino-logger";
import path from "path";
import createMediasoupSocket from "./mediasoup";

const os = require('os');


const config = require("./config");

const logger = pino({level: process.env.LOG_LEVEL || 'info'});

const app = express();
app.use(express.urlencoded({extended: true}));
app.use(cors({origin: true}));
app.options('*', cors());
app.use(express.json());
app.use(expressPino());


let authCounts = 0;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const getToken = (): Promise<string> => {
    return fetch(config.auth_url + "/login", {
        headers: {
            'Content-Type': 'application/json'
        },
        method: "POST",
        body: JSON.stringify({
            email: config.email,
            password: config.password
        })
    })
        .then(result => {
            if (result.ok) {
                logger.info("Logged in as " + config.email);
                return result.json();
            }
            throw new Error(result.statusText);
        })
        .then(t => {
            token = t;
            authCounts = 0;
            return t;
        });
}

export async function fetchRouter(token: string, url: string, ipv4: string, ipv6: string, port: number, slotAvailable: number) {
    const result = await fetch(config.api_url + "/routers/create", {
        headers: {
            'Content-Type': 'application/json',
            Authorization: "Bearer " + token
        },
        method: "POST",
        body: JSON.stringify({
            url: url,
            ipv4: ipv4,
            ipv6: ipv6,
            port: port
        })
    });
    if (result.ok) {
        logger.info("Registered router as " + url);
        return result.json();
    }
    throw new Error(result.statusText);
}

export const getProducer = async (token: string, id: string): Promise<Producer> => {
    return fetch(config.api_url + "/producers/" + id, {
        headers: {
            'Content-Type': 'application/json',
            Authorization: "Bearer " + token
        },
    })
        .then(async result => {
            if (result.ok)
                return result.json();
            throw new Error(result.statusText);
        });
}

let token = null;
export const getProducerAndEventuallyRequestToken = async (id: string): Promise<Producer> => {
    if (!token) {
        throw new Error("Token is null");
    }
    return getProducer(token, id)
        .catch(error => {
            if (error === "Unauthorized") {
                // Retry
                logger.warn("Refresh token")
                return sleep(1000)
                    .then(() => getToken())
                    .then(token => getProducer(token, id));
            }
        })
};

const url = config.domain ? config.domain : os.hostname();


const registerRouter = async (): Promise<Router> => {
    // Register this server globally
    const ipv4: string = await publicIp.v4()
        .catch((error) => {
            console.error(error);
            return "";
        });
    const ipv6: string = await publicIp.v6()
        .catch((error) => {
            console.error(error);
            return "";
        });
    const cpuCount: number = os.cpus().length;

    token = await getToken();

    return await fetchRouter(
        token,
        url,
        ipv4,
        ipv6,
        config.publicPort,
        cpuCount * config.connectionsPerCpu
    );
}

const startServer = () =>
    registerRouter()
        //.then(router => createMediasoupExpress(router))
        .then((router: Router): Promise<any> => {
            //app.use(mediasoupExpress);

            if (config.useSSL === "true") {
                const server = https.createServer({
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
                return createMediasoupSocket(router, server)
                    .then(() => server.listen(config.listenPort));
            } else {
                const server = app.listen(config.listenPort);
                return createMediasoupSocket(router, server);
            }
        });

startServer()
    .then(() => {
        console.log("Running on " + (config.useSSL === "true" ? "https://" : "http://") + url + ":" + config.listenPort);
    })
    .catch(error => console.error(error));

module.exports = app;
