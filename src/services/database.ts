import { Injectable } from '@hacker-und-koch/di';
import * as firebase from 'firebase';

import { HardwareInfo } from './hardware-info';
import config from '../config';
import { DatabaseRouter, DatabaseProducer } from '../model';
import { FIREBASE_CONFIG } from "../env";

@Injectable()
export class Database {
    private _routerId: string;

    routerRef: firebase.database.Reference;

    constructor(private hw: HardwareInfo) { }

    get routerId() { return this._routerId; }

    async onInit() {
        firebase.initializeApp(FIREBASE_CONFIG);

        this.routerRef = await firebase
            .database()
            .ref("routers")
            .push();

        const serverPayload: DatabaseRouter = {
            id: this.routerRef.key,
            ipv4: this.hw.ip4,
            ipv6: this.hw.ip6,
            domain: this.hw.domain,
            port: config.webserver.publicPort,
            slotAvailable: this.hw.cpuCount * config.mediasoup.connectionsPerCpu,
        };
        await this.routerRef.set(serverPayload);
        await this.routerRef.onDisconnect().remove();
    }

    async onDestroy() {
        // not sure if needed
        if (this.routerRef) {
            await this.routerRef.remove();
        }
    }

    getGlobalProducer(globalProducerId: string): Promise<DatabaseProducer> {
        return firebase.database()
            .ref("producers/" + globalProducerId)
            .once("value")
            .then((snapshot) => {
                return snapshot.val() as DatabaseProducer;
            });
    }

}
