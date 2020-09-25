import express from "express";
import cors from "cors";
import * as http from "http";
import * as https from "https";
import * as publicIp from "public-ip";
import mediasoup from "./mediasoup";
import * as fs from "fs";
import {Producer, Router} from "./model/model.common";
import fetch from "node-fetch";

const os = require('os');

const connectionsPerCpu = 500;

const AUTH_URL = "https://auth.api.digital-stage.org";
const API_URL = "http://localhost:4000";

const config = require("./config");

const app = express();
app.use(express.urlencoded({extended: true}));
app.use(cors({origin: true}));
app.options('*', cors());

const server = process.env.SSL ? https.createServer({
    key: fs.readFileSync(config.sslKey),
    cert: fs.readFileSync(config.sslCrt),
    ca: config.ca && fs.readFileSync(config.ca),
    requestCert: false,
    rejectUnauthorized: false
}, app) : http.createServer(app);

const startServer = async () => {
    server.listen(config.listenPort);
};

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

let token = null;
const getToken = (): Promise<any> => {
    return fetch(AUTH_URL + "/login", {
        headers: {
            'Content-Type': 'application/json'
        },
        method: "POST",
        body: JSON.stringify({
            email: "test@digital-stage.org",
            password: "testtesttest"
        })
    })
        .then(result => {
            if (result.ok)
                return result.json();
            throw new Error(result.statusText);
        })
        .then(t => {
            token = t;
            authCounts = 0;
        });
}
let authCounts = 0;
export const getProducer = async (id: string): Promise<Producer> => {
    if (!token) {
        await getToken();
    }
    return fetch(API_URL + "/producer/" + id, {
        headers: {
            'Content-Type': 'application/json',
            Authorization: "Bearer " + token
        },
    })
        .then(async result => {
            if (result.ok)
                return result.json();
            if (result.statusText === "Unauthorized") {
                // Try again
                authCounts++;
                if (authCounts < 10) {
                    await sleep(1000);
                    return getToken()
                        .then(() => getProducer(id));
                }
            }
            throw new Error(result.statusText);
        })
}
export const registerRouter = (url: string, ipv4: string, ipv6: string, port: number, slotAvailable: number) => {
    return fetch(API_URL + "/routers/create", {
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
    })
        .then(async result => {
            if (result.ok)
                return result.json();
            if (result.statusText === "Unauthorized") {
                // Try again
                authCounts++;
                if (authCounts < 10) {
                    await sleep(1000);
                    return getToken()
                        .then(() => registerRouter(url, ipv4, ipv6, port, slotAvailable));
                }
            }
            throw new Error(result.statusText);
        })
};


startServer().then(
    async () => {
        console.log("Running on " + config.domain + " port " + config.listenPort);

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

        const router: Router = await registerRouter(
            config.domain ? config.domain : os.hostname(),
            ipv4,
            ipv6,
            config.publicPort,
            cpuCount * connectionsPerCpu
        );
        app.use(mediasoup(router._id, ipv4, ipv6));
        console.log("Successfully published router capabilities!")
    }
);

module.exports = app;
