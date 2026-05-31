import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Vite 8 requires a dedicated JS/TS entry for SSR builds (no more index.html).
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: isSsrBuild ? 'src/entry-server.ts' : 'index.html',
    },
  },
  ssr: {
    // Keep Svelte out of the SSR externals so Vite transforms .svelte files
    noExternal: ['svelte', /^svelte\//],
  },
}));
