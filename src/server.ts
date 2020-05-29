import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';

import { Injectable, InjectConfiguration } from '@hacker-und-koch/di';
import { Logger } from '@hacker-und-koch/logger';
import * as cors from 'cors';
import * as express from 'express';
import { Mediasoup } from './mediasoup';
import config from './config';

@Injectable()
export class Server {
    private server: http.Server | https.Server;
    private expressApp: express.Express;

    constructor(private mediasoup: Mediasoup, private logger: Logger) { }

    onConfigure() {
        this.expressApp = express();
        this.expressApp.use(express.urlencoded({ extended: true }));
        this.expressApp.use(cors({ origin: true }));
        this.expressApp.options('*', cors());

        this.expressApp.use((req, res, next) => {
            const start = Date.now();
            res.once('finish', () => {
                this.logger.info(`${req.method} ${req.url} -> ${res.statusCode} in ${Date.now() - start}ms`);
            });
            next();
        });

        this.expressApp.use(this.mediasoup.expressRouter);
        if (process.env.SSL) {
            const serverOpts: https.ServerOptions = {
                key: fs.readFileSync(config.webserver.sslKey),
                cert: fs.readFileSync(config.webserver.sslCrt),
                ca: config.webserver.ca && fs.readFileSync(config.webserver.ca),
                requestCert: false,
                rejectUnauthorized: false
            };
            this.server = https.createServer(serverOpts, this.expressApp)
        } else {
            this.server = http.createServer(this.expressApp);
        }
    }

    onInit() {
        return new Promise(resolve => {
            const port = config.webserver.listenPort;
            this.server.listen(port, () => {
                this.logger.log(`webserver listening on *:${port}`);
                resolve();
            });
        });
    }
}