module.exports = {
    email: 'test@digital-stage.org',
    password: 'testtesttest',
    connectionsPerCpu: 500,
    auth_url: process.env.NODE_ENV === "production" ? process.env.AUTH_URL : "https://auth.api.digital-stage.org",
    api_url: process.env.NODE_ENV === "production" ? process.env.API_URL : "http://localhost:4000",
    domain: process.env.NODE_ENV === "production" ? process.env.DOMAIN : "localhost",
    listenIp: "0.0.0.0",
    listenPort: process.env.PORT,
    publicPort: process.env.PUBLIC_PORT ? process.env.PUBLIC_PORT : process.env.PORT,
    useSSL: process.env.SSL,
    sslCrt: process.env.NODE_ENV === "production" && process.env.SSL === "true" ? process.env.CRT : "./ssl/cert.pem",
    sslKey: process.env.NODE_ENV === "production" && process.env.SSL === "true" ? process.env.KEY : "./ssl/key.pem",
    ca: process.env.NODE_ENV === "production" && process.env.SSL === "true" ? process.env.CA : undefined,

    mediasoup: {
        // Worker settings
        worker: {
            rtcMinPort: 40000,
            rtcMaxPort: 49999,
            logLevel: "warn",
            logTags: [
                "info",
                "ice",
                "dtls",
                "rtp",
                "srtp",
                "rtcp",
                // 'rtx',
                // 'bwe',
                // 'score',
                // 'simulcast',
                // 'svc'
            ],
        },
        // Router settings
        router: {
            mediaCodecs:
                [
                    {
                        kind: "audio",
                        mimeType: "audio/opus",
                        clockRate: 48000,
                        channels: 2
                    },
                    {
                        kind: "video",
                        mimeType: "video/VP8",
                        clockRate: 90000,
                        parameters:
                            {
                                "x-google-start-bitrate": 1000
                            }
                    },
                    {
                        kind: "video",
                        mimeType: "video/VP9",
                        clockRate: 90000,
                        parameters:
                            {
                                "profile-id": 2,
                                "x-google-start-bitrate": 1000
                            }
                    },
                    {
                        kind: "video",
                        mimeType: "video/h264",
                        clockRate: 90000,
                        parameters:
                            {
                                "packetization-mode": 1,
                                "profile-level-id": "4d0032",
                                "level-asymmetry-allowed": 1,
                                "x-google-start-bitrate": 1000
                            }
                    },
                    {
                        kind: "video",
                        mimeType: "video/h264",
                        clockRate: 90000,
                        parameters:
                            {
                                "packetization-mode": 1,
                                "profile-level-id": "42e01f",
                                "level-asymmetry-allowed": 1,
                                "x-google-start-bitrate": 1000
                            }
                    }
                ]
        },
        // WebRtcTransport settings
        webRtcTransport: {
            listenIps: [
                {
                    ip: process.env.NODE_ENV === "production" ? process.env.IP : "127.0.0.1",
                    announcedIp: null,
                }
            ],
            maxIncomingBitrate: 1500000,
            initialAvailableOutgoingBitrate: 1000000,
            minimumAvailableOutgoingBitrate: 600000,
            maxSctpMessageSize: 262144
        }
    }
};
