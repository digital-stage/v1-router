import * as express from "express";
import * as firebase from 'firebase';
import * as cors from "cors";
import * as http from "http";
import * as publicIp from "public-ip";
import mediasoup from "./mediasoup";
import {DatabaseRouter} from "./model";
import {FIREBASE_CONFIG} from "./env";

const os = require('os');

const connectionsPerCpu = 500;

const config = require("./config");

const port = config.listenPort;

firebase.initializeApp(FIREBASE_CONFIG);

const app = express();
app.use(express.urlencoded({extended: true}));
app.use(cors({origin: true}));
app.options('*', cors());

const server = http.createServer(app);

const startServer = async () => {
    server.listen(port);
};
startServer().then(
    async () => {
        console.log("Running on port " + port);

        // Register this server globally
        const ipv4: string = await publicIp.v4();
        const ipv6: string = await publicIp.v6();
        const cpuCount: number = os.cpus().length;
        const routerRef: firebase.database.Reference = firebase
            .database()
            .ref("routers")
            .push()
        const serverPayload: DatabaseRouter = {
            id: routerRef.key,
            ipv4: ipv4,
            ipv6: ipv6,
            domain: config.domain ? config.domain : os.hostname(),
            port: port,
            slotAvailable: cpuCount * connectionsPerCpu
        };
        await routerRef.set(serverPayload);
        await routerRef.onDisconnect().remove();
        app.use(mediasoup(routerRef.key, ipv4, ipv6));
        console.log("Successfully published router capabilities!")
    }
);

module.exports = app;
