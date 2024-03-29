import {
  RTC_MAX_PORT, RTC_MIN_PORT,
} from './env';
import { MediasoupConfiguration } from './mediasoup';

const config: MediasoupConfiguration = {
  // Worker settings
  worker: {
    rtcMinPort: RTC_MIN_PORT ? parseInt(RTC_MIN_PORT, 10) : 40000,
    rtcMaxPort: RTC_MIN_PORT ? parseInt(RTC_MAX_PORT, 10) : 49999,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
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
                kind: 'audio',
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
                rtcpFeedback: [{
                  type: 'transport-cc',
                }],
              },
              {
                kind: 'audio',
                mimeType: 'audio/PCMU',
                preferredPayloadType: 0,
                clockRate: 8000,
                rtcpFeedback: [{
                  type: 'transport-cc',
                }],
              },
              {
                kind: 'audio',
                mimeType: 'audio/PCMA',
                preferredPayloadType: 8,
                clockRate: 8000,
                rtcpFeedback: [{
                  type: 'transport-cc',
                }],
              },
              {
                kind: 'video',
                mimeType: 'video/VP8',
                clockRate: 90000,
                parameters:
                        {
                          'x-google-start-bitrate': 1000,
                        },
              },
              {
                kind: 'video',
                mimeType: 'video/VP9',
                clockRate: 90000,
                parameters:
                        {
                          'profile-id': 2,
                          'x-google-start-bitrate': 1000,
                        },
              },
              {
                kind: 'video',
                mimeType: 'video/h264',
                clockRate: 90000,
                parameters:
                        {
                          'packetization-mode': 1,
                          'profile-level-id': '4d0032',
                          'level-asymmetry-allowed': 1,
                          'x-google-start-bitrate': 1000,
                        },
              },
              {
                kind: 'video',
                mimeType: 'video/h264',
                clockRate: 90000,
                parameters:
                        {
                          'packetization-mode': 1,
                          'profile-level-id': '42e01f',
                          'level-asymmetry-allowed': 1,
                          'x-google-start-bitrate': 1000,
                        },
              },
            ],
  },
  // WebRtcTransport settings
  webRtcTransport: {
    listenIps: [
      // Will be set later
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
  },
};
export default config;
