import { defineEndpoint } from '@verso-js/verso';
import { delay } from '../delay';
import { cookieLatency } from './cookieLatency';

export default defineEndpoint(({ getRoute }) => {
  let userId: number;
  return {
    async getRouteDirective() {
      userId = Number(getRoute().params['userId']);
      await delay(cookieLatency('theme', 400));
      return { kind: 'ok' };
    },

    getContentType() {
      return 'application/json';
    },

    getResponseData() {
      return JSON.stringify({
        theme: userId % 2 === 0 ? 'light' : 'dark',
        accent: '#6366f1',
      });
    },
  };
});
