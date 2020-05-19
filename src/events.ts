
export const RouterGetUrls = {
    GetRTPCapabilities: "/rtp-capabilities",

    CreateTransport: "/transport/webrtc/create",

    CreatePlainTransport: "/transport/plain/create",
}

export const RouterPostUrls = {
    ConnectTransport: "/transport/webrtc/connect",
    CloseTransport: "/transport/webrtc/close",

    ConnectPlainTransport: "/transport/plain/connect",
    ClosePlainTransport: "/transport/plain/close",

    // Auth required:
    CreateProducer: "/producer/create",
    PauseProducer: "/producer/pause",
    ResumeProducer: "/producer/resume",
    CloseProducer: "/producer/close",

    // Auth required:
    CreateConsumer: "/consumer/create",
    PauseConsumer: "/consumer/pause",
    ResumeConsumer: "/consumer/resume",
    CloseConsumer: "/consumer/close",
}
