import { defineConfig } from '@solidjs/start/config';

export default defineConfig({
  vite: {
    ssr: {
      external: ['laikacms', '@laikacms/decap-integrations'],
    },
  },
});
