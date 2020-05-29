import { cpus, hostname } from 'os';

import { Injectable } from '@hacker-und-koch/di';
import { Logger } from '@hacker-und-koch/logger';
import * as publicIp from 'public-ip';
import config from '../config';

@Injectable()
export class HardwareInfo {
    private _ip4: string;
    private _ip6: string;
    private _cpuCount: number;
    private _domain: string;

    get ip4(): string { return this._ip4; }
    get ip6(): string { return this._ip6; }
    get cpuCount(): number { return this._cpuCount; }
    get domain(): string { return this._domain; }

    constructor(private logger: Logger) { }

    async onConfigure() {
        this.logger.info('Trying to determine own external IP address. This may take a while ...');
        const [ip4, ip6] = await Promise.all([
            cancelAfter(publicIp.v4(), 3e3)
                .catch((error) => {
                    this.logger.warn(`Failed to determine IPv4:`, error.message);
                    return "";
                }),
            cancelAfter(publicIp.v6(), 3e3)
                .catch((error) => {
                    this.logger.warn(`Failed to determine IPv6:`, error.message);
                    return "";
                }),
        ]);

        this._ip4 = ip4;
        this.logger.log(`public ipv4: ${this._ip4 || 'UNKNOWN'}`);

        this._ip6 = ip6;
        this.logger.log(`public ipv6: ${this._ip6 || 'UNKNOWN'}`);

        this._cpuCount = cpus().length;
        this.logger.log(`operating on ${this._cpuCount} cores.`);

        this._domain = config.webserver.domain || hostname();
    }
}

function cancelAfter<T>(promise: Promise<T>, timeout = 1000, errorMessage?: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const to = setTimeout(() => reject(new Error(errorMessage || 'Timeout')), timeout);
            return () => clearTimeout(to);
        }) as Promise<T>,
    ]);
}