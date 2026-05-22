import { defineEndpoint } from '@verso-js/verso';
import { delay } from '../delay';
import { cookieLatency } from './cookieLatency';

const NAMES: Record<number, string> = {
  1: 'Alice',
  2: 'Bob',
  3: 'Charlie',
  4: 'Dana',
  5: 'Eve',
};

export default defineEndpoint(({ getRoute }) => {
  let id: number;
  return {
    async getRouteDirective() {
      id = Number(getRoute().params['id']);
      await delay(cookieLatency('users', 500));
      return { status: 200 };
    },

    getContentType() {
      return 'application/json';
    },

    getResponseData() {
      return JSON.stringify({
        username: NAMES[id] ?? `User${id}`,
        email: `user${id}@example.com`,
      });
    },
  };
});
