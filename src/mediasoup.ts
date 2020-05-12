import {Router as ExpressRouter} from "express";
import {Worker} from "mediasoup/lib/Worker";
import * as mediasoup from "mediasoup";
import {MediasoupGetUrls, MediasoupPostUrls} from "./events";
import * as os from "os";
import {Router} from "mediasoup/lib/Router";
import {DtlsParameters, WebRtcTransport} from "mediasoup/lib/WebRtcTransport";
import {PlainTransport} from "mediasoup/lib/PlainTransport";

const config = require("./config");
const connectionsPerCpu = 500;

let initialized: boolean = false;
const router: {
    router: Router,
    numConnections: number
}[] = [];
const webRTCTransports: {
    [id: string]: WebRtcTransport
} = {};
const plainTransports: {
    [id: string]: PlainTransport
} = {};

const init = async () => {
    const cpuCount: number = os.cpus().length;
    const mediaCodecs = config.mediasoup.router.mediaCodecs;
    for (let i = 0; i < cpuCount; i++) {
        const worker: Worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.worker.logLevel,
            logTags: config.mediasoup.worker.logTags,
            rtcMinPort: config.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config.mediasoup.worker.rtcMaxPort
        });
        const workerRouter: Router = await worker.createRouter({mediaCodecs});
        router.push({router: workerRouter, numConnections: 0});
    }
    initialized = true;
};

const getAvailableRouter = (): Router | null => {
    for (let i = 0; i < router.length; i++) {
        if (router[i].numConnections < connectionsPerCpu) {
            return router[i].router;
        }
    }
    return null;
};

export default (ipv4: string, ipv6: string): ExpressRouter => {
    init();

    const express = ExpressRouter();

    express.get("/", (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        res.status(200).send("Alive and kick'n with " + router.length + " cores !");
    });

    express.get(MediasoupGetUrls.GetRTPCapabilities, (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        res.status(200).send(JSON.stringify(router[0].router.rtpCapabilities));
    });

    express.get(MediasoupGetUrls.CreateWebRTCTransport, (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        const router: Router | null = getAvailableRouter();
        if (!router) {
            return res.status(501).send("Full");
        }

        router.createWebRtcTransport({
            preferTcp: false,
            listenIps: config.mediasoup.webRtcTransport.listenIps,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate
        }).then((transport: WebRtcTransport) => {
            webRTCTransports[transport.id] = transport;

            res.status(200).send(JSON.stringify({
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
                sctpParameters: transport.sctpParameters,
                appData: transport.appData
            }));
        }).catch((error) => {
                console.error(error);
                res.status(501).send("Error");
            }
        )
    });


    express.get(MediasoupGetUrls.CreatePlainRTPTransport, (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        const router: Router | null = getAvailableRouter();
        if (!router) {
            return res.status(501).send("Full");
        }

        router.createPlainTransport({
            listenIp: ipv6,
            rtcpMux: true,
            comedia: true
        }).then((transport: PlainTransport) => {
            plainTransports[transport.id] = transport;

            res.status(200).send(JSON.stringify({
                sctpParameters: transport.sctpParameters,
                appData: transport.appData
            }));
        }).catch((error) => {
                console.error(error);
                res.status(501).send("Error");
            }
        )
    });

    express.post(MediasoupPostUrls.ConnectTransport, (req, res, next) => {
        if (!initialized) {
            return res.status(501).send("Not ready yet");
        }
        if (!req.body.transportId) {
            return res.status(501).send("Invalid request");
        }
        const transportId: string = req.body.transportId;
        const dtlsParameters: DtlsParameters = JSON.parse(req.body.dtlsParameters);

        const webRtcTransport: WebRtcTransport = webRTCTransports[transportId];
        if (webRtcTransport) {
            if (!req.body.dtlsParameters) {
                return res.status(501).send("Invalid request");
            }
            return webRtcTransport.connect({dtlsParameters: dtlsParameters}).then(
                () => {
                    res.status(200).send();
                }
            );
        }
        const plainTransport: PlainTransport = plainTransports[transportId];
        if (plainTransport) {
            return plainTransport.connect({
                ip: req.body.ip,
                port: req.body.port,
                rtcpPort: req.body.rtcpPort,
                srtpParameters: req.body.srtpParameters,
            }).then(
                () => {
                    res.status(200).send();
                }
            );
        }
        return res.status(400).send("Not found");
    });

    express.post(MediasoupPostUrls.SendTrack, (req, res) => {

    });

    return express;
}
