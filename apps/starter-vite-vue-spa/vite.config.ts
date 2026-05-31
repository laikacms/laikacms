import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// The SPA dev server (port 3000) proxies /api/* and /admin to the sidecar
// Hono backend (port 3001). In production, your CDN/host plays the same
// role — the SPA hits `/api/...` relative to its own origin.
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/admin': 'http://localhost:3001',
    },
  },
});
