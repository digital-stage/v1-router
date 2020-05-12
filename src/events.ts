import {RtpCapabilities} from "mediasoup/lib/RtpParameters";
import {DtlsParameters} from "mediasoup/src/WebRtcTransport";
import {SrtpParameters} from "mediasoup/lib/SrtpParameters";

export const MediasoupGetUrls = {
    GetRTPCapabilities: "/rtp-capabilities",
    CreateWebRTCTransport: "/create-webrtc-transport",
    CreatePlainRTPTransport: "/create-plain-transport",
};
export const MediasoupPostUrls = {
    ConnectTransport: "/connect-transport",
    SendTrack: "/send-track",
    ConsumePlain: "/consume-plain",
    ConsumeWebRTC: "/consume-webrtc",
    FinishConsume: "/finish-consume"
};

export interface GetRTPCapabilitiesResult extends RtpCapabilities {
}


export interface ConnectTransportPayload {
    transportId: string;
}

export interface ConnectPlainTransportPayload extends ConnectTransportPayload {
    ip?: string;
    port?: number;
    rtcpPort?: number;
    srtpParameters?: SrtpParameters;
}

export interface ConnectWebRTCTransportPayload extends ConnectTransportPayload {
    dtlsParameters: DtlsParameters;
}
