import {RtpCapabilities} from "mediasoup/lib/RtpParameters";

export const MediasoupGetUrls = {
    GetRTPCapabilities: "/rtp-capabilities",
    CreateWebRTCTransport: "/create-webrtc-transport",
    CreatePlainRTPTransport: "/create-plain-transport",
};
export const MediasoupPostUrls = {
    ConnectTransport: "/connect-transport",
    SendTrack: "/send-track",
    Consume: "/consume",
    FinishConsume: "/finish-consume"
};

export interface GetRTPCapabilitiesResult extends RtpCapabilities {
}
