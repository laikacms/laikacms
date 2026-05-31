import devServer from '@hono/vite-dev-server';
import honox from 'honox/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    honox(),
    devServer({
      entry: 'app/server.ts',
    }),
  ],
});
