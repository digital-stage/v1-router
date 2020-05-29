import { Application, config } from '@hacker-und-koch/di';
import { Mediasoup } from './mediasoup';
import { HardwareInfo, Database } from './services';
import { Server } from './server';
import applicationConfig from './config';

@Application({
    declarations: [
        Mediasoup,
        HardwareInfo,
        Server,
        Database,
    ],
})
export class App {
    constructor(private server: Server) { }

}
