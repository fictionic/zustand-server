import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    IS_SERVER: 'false',
  },
});
