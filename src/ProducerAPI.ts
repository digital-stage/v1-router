import fetch from 'node-fetch';
import debug from 'debug';
import { GlobalAudioProducerId, GlobalVideoProducerId } from './model/model.server';
import { getToken } from './util';

const {
  API_URL,
} = process.env;

const log = debug('router:producerapi');
const warn = log.extend('warn');

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class ProducerAPI {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private fetchProducer(id: GlobalAudioProducerId | GlobalVideoProducerId) {
    return fetch(`${API_URL}/producers/${id}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    })
      .then(async (result) => {
        if (result.ok) return result.json();
        warn(`Got invalid result ${result.status} from ${API_URL}/producers/${id}`);
        throw new Error(result.statusText);
      });
  }

  private getProducerWithRetries(
    id: GlobalAudioProducerId | GlobalVideoProducerId,
    retries: number = 10,
  ) {
    return this.fetchProducer(id)
      .catch((error) => {
        if (retries > 0) {
          if (error === 'Unauthorized') {
            warn(`Invalid token, ${retries} retries left`);
            return sleep(1000)
              .then(() => getToken())
              .then((token) => {
                this.token = token;
              })
              .then(() => this.getProducerWithRetries(id, (retries - 1)));
          }
        }
        throw error;
      });
  }

  getProducer(id: GlobalAudioProducerId | GlobalVideoProducerId) {
    return this.getProducerWithRetries(id, 10);
  }
}
export default ProducerAPI;
