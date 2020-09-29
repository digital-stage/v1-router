export enum RouterEvents {
    TransportCreated = "transport-created",
    TransportPaused = "transport-connected",
    TransportCloses = "transport-closed",
    ProducerCreated = "producer-created",
    ProducerPaused = "producer-paused",
    ProducerResumed = "producer-resumed",
    ProducerCloses = "producer-closed",
    ConsumerCreated = "consumer-created",
    ConsumerPaused = "consumer-paused",
    ConsumerResumed = "consumer-resumed",
    ConsumerCloses = "consumer-closed",
}

export enum RouterRequests {
    GetRTPCapabilities = "rtp-capabilities",
    CreateTransport = "create-transport",
    ConnectTransport = "connect-transport",
    CloseTransport = "close-transport",
    CreateProducer = "create-producer",
    PauseProducer = "pause-producer",
    ResumeProducer = "resume-producer",
    CloseProducer = "close-producer",
    CreateConsumer = "create-consumer",
    PauseConsumer = "pause-consumer",
    ResumeConsumer = "resume-consumer",
    CloseConsumer = "close-consumer",
}

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
