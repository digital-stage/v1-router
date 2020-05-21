/**
 * Location in firestore:
 * /users/{uid}
 *
 * Read access only to authenticated clients with uid
 */
export interface DatabaseUser {
    uid: string;
    stageId?: string;
}

/**
 * Location in firestore:
 * /stages/{stageId}
 *
 * Read access to all authenticated clients (currently) TODO: Only access if user is actual member of this stage
 */
export interface DatabaseStage {
    id: string;
    name: string;
    password: string;
}

/**
 * Member of a DatabaseStage
 *
 * Location in firestore:
 * /stages/{stageId}/members/{uuid}
 *
 * Read access to all authenticated clients (currently) TODO: Only access if user is actual member of this stage
 */
export interface DatabaseStageMember {
    uid: string;
    displayName: string;
}

/**
 * Router
 *
 * Location in realtime database:
 * /routers/{uuid}
 *
 * Read access to all
 */
export interface DatabaseRouter {
    ipv4: string,
    ipv6: string,
    domain: string;
    port: number,
    slotAvailable: number
}

/**
 * Global producer
 *
 * Location in firestore:
 * /routers/{uuid}
 *
 * Read access to all authenticated clients
 */
export interface DatabaseGlobalProducer {
    uid: string;        // Globally unique
    stageId: string;    // Globally unique
    routerId: string;   // Globally unique
    producerId: string; // Only unique inside routerId
    deviceId: string;   // Globally unique
    kind: string;
}

/**
 * Device
 *
 * Location in realtime database:
 * /devices/{deviceId}
 *
 * Read access only to authenticated client with uid
 */
export interface DatabaseDevice {
    uid: string;

    ipv4: string;
    ipv6: string;

    canAudio: boolean;
    canVideo: boolean;

    sendAudio: boolean;
    sendVideo: boolean;
    receiveAudio: boolean;
    receiveVideo: boolean;
}
