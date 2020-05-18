export interface DatabaseRouter {
    ipv4: string,
    ipv6: string,
    port: number,
    slotAvailable: number
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
