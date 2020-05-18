import * as admin from "firebase-admin";
import {DatabaseProducer} from "./model";

export const getStageId = async (uid: string): Promise<string> => {
    return new Promise<string>(async (resolve, reject) => {
        return admin
            .database()
            .ref("users")
            .child(uid)
            .once("value")
            .then((snapshot: admin.database.DataSnapshot) => {
                if (snapshot.exists()) {
                    if (snapshot.val().stageId) {
                        return resolve(snapshot.val().stageId);
                    }
                    return reject("Not in a stage");
                }
                return reject("Internal error: no user table available");
            });
    });
}

export const getGlobalProducer = async (globalProducerId: string): Promise<DatabaseProducer> => {
    return new Promise<DatabaseProducer>(async (resolve, reject) => {
        return admin
            .database()
            .ref("producers")
            .child(globalProducerId)
            .once("value")
            .then((snapshot: admin.database.DataSnapshot) => {
                if (snapshot.exists()) {
                    return resolve(snapshot.val() as DatabaseProducer)
                }
                return reject("Could not find producer");
            });
    });
}
