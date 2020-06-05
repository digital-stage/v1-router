import express from "express";
import * as firebase from 'firebase/app';
import "firebase/database"
import cors from "cors";
import * as http from "http";
import * as https from "https";
import * as publicIp from "public-ip";
import mediasoup from "./mediasoup";
import {DatabaseRouter} from "./model";
import {FIREBASE_CONFIG} from "./env";
import * as fs from "fs";

const os = require('os');

const connectionsPerCpu = 500;

const config = require("./config");

firebase.initializeApp(FIREBASE_CONFIG);

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
        const routerRef: firebase.database.Reference = await firebase
            .database()
            .ref("routers")
            .push();
        const serverPayload: DatabaseRouter = {
            id: routerRef.key,
            ipv4: ipv4,
            ipv6: ipv6,
            domain: config.domain ? config.domain : os.hostname(),
            port: config.publicPort,
            slotAvailable: cpuCount * connectionsPerCpu
        };
        await routerRef.set(serverPayload);
        await routerRef.onDisconnect().remove();
        app.use(mediasoup(routerRef.key, ipv4, ipv6));
        console.log("Successfully published router capabilities!")
    }
);

module.exports = app;
