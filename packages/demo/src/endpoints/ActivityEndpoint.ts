import { defineEndpoint } from '@verso-js/verso';
import { delay } from '../delay';
import { cookieLatency } from './cookieLatency';

export default defineEndpoint(() => ({
  async getRouteDirective() {
    await delay(cookieLatency('activity', 1500));
    return { kind: 'ok' };
  },

  getContentType() {
    return 'application/json';
  },

  getResponseData() {
    return JSON.stringify({
      items: [
        'Edited profile settings',
        'Uploaded a photo',
        'Sent a message to Bob',
        'Updated notification preferences',
        'Joined #general channel',
      ],
    });
  },
}));
