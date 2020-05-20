export interface DatabaseRouter {
    id: string;
    ipv4: string,
    ipv6: string,
    domain: string;
    port: number,
    slotAvailable: number
}

export interface DatabaseGlobalProducer {
    uid: string;        // Globally unique
    stageId: string;    // Globally unique
    routerId: string;   // Globally unique
    producerId: string; // Only unique inside routerId
    deviceId: string;   // Globally unique
    kind: string;
}

export interface DatabaseStage {
    id: string;
    name: string;
    password: string;
}

export interface DatabaseStageMember {
    uid: string;
    displayName: string;
}

export interface DatabaseProducer {
    uid: string;
    stageId: string;
    routerId: string;
    kind: string;
}
