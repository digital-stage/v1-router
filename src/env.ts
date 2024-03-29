import { config } from 'dotenv';

config();

const {
  PORT,
  API_URL,
  AUTH_URL,
  DOMAIN,
  PUBLIC_PORT,
  CONNECTIONS_PER_CPU,
  EMAIL,
  PASSWORD,
  IP_V4,
  IP_V6,
  WS_PREFIX,
  REST_PREFIX,
  ROOT_PATH,
  DISTRIBUTION_URL,
  RTC_MIN_PORT,
  RTC_MAX_PORT,
  LISTEN_IP,
  ANNOUNCED_IP,

} = process.env;

const USE_DISTRIBUTION = process.env.USE_DISTRIBUTION && process.env.USE_DISTRIBUTION === 'true';
const USE_IPV6 = process.env.USE_IPV6 && process.env.USE_IPV6 === 'true';

const MEDIASOUP_CONFIG = require('./config').default;

export {
  PORT,
  API_URL,
  AUTH_URL,
  USE_IPV6,
  DOMAIN,
  PUBLIC_PORT,
  CONNECTIONS_PER_CPU,
  EMAIL,
  PASSWORD,
  IP_V4,
  IP_V6,
  WS_PREFIX,
  REST_PREFIX,
  ROOT_PATH,
  MEDIASOUP_CONFIG,
  USE_DISTRIBUTION,
  DISTRIBUTION_URL,
  RTC_MIN_PORT,
  RTC_MAX_PORT,
  LISTEN_IP,
  ANNOUNCED_IP,
};
