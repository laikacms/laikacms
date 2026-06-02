import devServer from '@hono/vite-dev-server';
import honox from 'honox/vite';
import { defineConfig } from 'vite';

// HonoX is server-rendered; vite build needs an explicit SSR entry — without
// one, Vite 8 falls back to looking for index.html and fails.
export default defineConfig({
  plugins: [
    honox(),
    devServer({
      entry: 'app/server.ts',
    }),
  ],
  build: {
    ssr: 'app/server.ts',
    outDir: 'dist',
    rollupOptions: {
      output: { entryFileNames: 'server.js' },
    },
  },
});
