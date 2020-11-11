import fetch from 'node-fetch';
import pino from 'pino';
import * as publicIp from 'public-ip';
import os from 'os';
import { config } from 'dotenv';
import {
  Router,
} from './model/model.server';

config();

const {
  AUTH_URL, USE_IPV6, DOMAIN, PORT, CONNECTIONS_PER_CPU, LOG_LEVEL, EMAIL, PASSWORD,
} = process.env;

const logger = pino({ level: LOG_LEVEL || 'info' });

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
      logger.info(`Logged in as ${EMAIL}`);
      return result.json();
    });
}

export async function createInitialRouter(): Promise<Partial<Router>> {
  const ipv4: string = await publicIp.v4()
    .catch((error) => {
      logger.warn('Could not obtain IPv4 address:');
      logger.warn(error);
      return '';
    });

  let ipv6: string = '';
  if (USE_IPV6) {
    ipv6 = await publicIp.v6()
      .catch((error) => {
        logger.warn('Could not obtain IPv6 address:');
        logger.warn(error);
        return '';
      });
  }
  const cpuCount: number = os.cpus().length;

  const initial = {
    url: DOMAIN,
    port: parseInt(PORT, 10),
    ipv4,
    ipv6,
    availableSlots: cpuCount * parseInt(CONNECTIONS_PER_CPU, 10),
  };
  logger.info('Using initial configuration:');
  logger.info(initial);

  return initial;
}
