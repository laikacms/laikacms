import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  // In dev mode this config is used by vite.createServer() inside server.ts.
  // In production, `vite build` (client) and `vite build --ssr` (server) use it.
  build: {
    rollupOptions: {
      // Client entry: only needed if you want hydration (this starter is static-markup only)
      input: 'index.html',
    },
  },
  ssr: {
    // Keep Svelte out of the SSR externals so Vite transforms .svelte files
    noExternal: ['svelte', /^svelte\//],
  },
});
