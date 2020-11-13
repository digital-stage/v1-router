import fetch from 'node-fetch';
import * as publicIp from 'public-ip';
import os from 'os';
import { config } from 'dotenv';
import debug from 'debug';
import {
  Router,
} from './model/model.server';

config();

const {
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
} = process.env;

const logger = debug('router');
const info = logger.extend('info');
const warn = logger.extend('warn');

export function getToken(): Promise<string> {
  return fetch(`${AUTH_URL}/login`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
    }),
  })
    .then((result) => {
      if (!result.ok) {
        throw new Error(result.statusText);
      }
      info(`Logged in as ${EMAIL}`);
      return result.json();
    });
}

export async function createInitialRouter(): Promise<Partial<Router>> {
  const ipv4: string = IP_V4 || await publicIp.v4()
    .catch((error) => {
      warn('Could not obtain IPv4 address:');
      warn(error);
      return '';
    });

  let ipv6: string = '';
  if (USE_IPV6) {
    ipv6 = IP_V6 || await publicIp.v6()
      .catch((error) => {
        warn('Could not obtain IPv6 address:');
        warn(error);
        return '';
      });
  }
  const cpuCount: number = os.cpus().length;

  const initial: Partial<Router> = {
    wsPrefix: WS_PREFIX || 'wss',
    restPrefix: REST_PREFIX || 'https',
    url: DOMAIN,
    port: parseInt(PUBLIC_PORT, 10),
    ipv4,
    ipv6,
    availableSlots: cpuCount * parseInt(CONNECTIONS_PER_CPU, 10),
  };
  info('Using initial configuration:');
  info(initial);

  return initial;
}
