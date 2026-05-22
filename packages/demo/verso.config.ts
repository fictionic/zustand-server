import { defineConfig } from '@verso-js/verso/config';

export default defineConfig({
  server: {
    allowedHosts: ['localhost:3000'],
    fetchOrigin: 'loopback',
  },
  client: {
    reuseDom: false,
  },
  middleware: ['./src/PageHeader'],
  routes: {
    // pages
    DemoPage: {
      path: '/',
      handler: './src/DemoPage',
    },
    LinkPage: {
      path: '/link',
      handler: './src/LinkPage',
    },
    // endpoints
    UsersEndpoint: {
      path: '/api/users/:id',
      handler: './src/endpoints/UsersEndpoint',
    },
    ThemeEndpoint: {
      path: '/api/theme/:userId',
      handler: './src/endpoints/ThemeEndpoint',
    },
    ActivityEndpoint: {
      path: '/api/activity',
      handler: './src/endpoints/ActivityEndpoint',
    },
  },
});
