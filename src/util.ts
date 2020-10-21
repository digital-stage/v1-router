import fetch from "node-fetch";
import pino from "pino";
import * as publicIp from "public-ip";
import os from "os";
import {GlobalAudioProducerId, GlobalVideoProducerId, Router, RouterId} from "./model/model.server";

const config = require("./config");

const logger = pino({level: process.env.LOG_LEVEL || 'info'});

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function getToken(): Promise<string> {
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
            if (!result.ok) {
                throw new Error(result.statusText);
            }
            logger.info("Logged in as " + config.email);
            return result.json();
        });
}

export async function createInitialRouter(): Promise<Partial<Router>> {
    const ipv4: string = await publicIp.v4()
        .catch((error) => {
            logger.warn("Could not obtain IPv4 address:");
            logger.warn(error);
            return "";
        });
    const ipv6: string = await publicIp.v6()
        .catch((error) => {
            logger.warn("Could not obtain IPv6 address:");
            logger.warn(error);
            return "";
        });
    const cpuCount: number = os.cpus().length;

    const initial = {
        url: config.domain,
        port: config.publicPort,
        ipv4: ipv4,
        ipv6: ipv6,
        availableSlots: cpuCount * config.connectionsPerCpu
    };
    logger.info("Using initial configuration:");
    logger.info(initial);

    return initial;
}

export class ProducerAPI {
    private token: string;

    constructor(token: string) {
        this.token = token;
    }

    private fetchProducer(id: GlobalAudioProducerId | GlobalVideoProducerId) {
        return fetch(config.api_url + "/producers/" + id, {
            headers: {
                'Content-Type': 'application/json',
                Authorization: "Bearer " + this.token
            },
        })
            .then(async result => {
                if (result.ok)
                    return result.json();
                logger.warn("Got invalid result " + result.status + " from " + config.api_url + "/producers/" + id);
                throw new Error(result.statusText);
            });
    }

    private getProducerWithRetries(id: GlobalAudioProducerId | GlobalVideoProducerId, retries: number = 10) {
        return this.fetchProducer(id)
            .catch(error => {
                if (retries > 0) {
                    if (error === "Unauthorized") {
                        logger.warn("Invalid token, " + retries + " retries left");
                        return sleep(1000)
                            .then(() => getToken())
                            .then(token => {
                                this.token = token
                            })
                            .then(() => this.getProducerWithRetries(id, --retries));
                    }
                }
                throw error;
            })
    }

    getProducer(id: GlobalAudioProducerId | GlobalVideoProducerId) {
        return this.getProducerWithRetries(id, 10);
    }
}

export class RouterList {
    private routers: Router[] = [];

    constructor() {
    }

    get(): Router[] {
        return this.routers;
    }

    add(router: Router) {
        this.routers.push(router);
    }

    update(change: Partial<Router>) {
        this.routers = this.routers.map(router => router._id === change._id ? {
            ...router,
            ...change
        } : router);
    }

    remove(id: RouterId) {
        this.routers = this.routers.filter(router => router._id !== id);
    }
}
