import * as express from "express";
import * as admin from "firebase-admin";
import * as cors from "cors";
import * as https from "https";
import * as fs from "fs";
import mediasoup from "./mediasoup";
import * as publicIp from "public-ip";

const os = require('os');

const connectionsPerCpu = 500;

const config = require("./config");

const port = process.env.PORT || config.listenPort;

const serviceAccount = require("../firebase-adminsdk.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://digitalstage-wirvsvirus.firebaseio.com"
});

const app = express();
app.use(express.urlencoded({extended: true}));
app.use(cors({origin: true}));
app.options('*', cors());

const server = https.createServer({
    key: fs.readFileSync(config.sslKey),
    cert: fs.readFileSync(config.sslCrt),
    ca: config.ca && fs.readFileSync(config.ca),
    requestCert: false,
    rejectUnauthorized: false
}, app);




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
        const serverPayload = {
            ipv4: ipv4,
            ipv6: ipv6,
            port: port,
            slotAvailable: cpuCount * connectionsPerCpu
        };
        app.use(mediasoup(ipv4, ipv6));
        admin.firestore().collection("router").doc(ipv4 + ":" + port)
            .set(serverPayload)
            .then(() => console.log("Successfully published router capabilities!"))
            .catch((error) => console.error(error));
    }
);

module.exports = app;