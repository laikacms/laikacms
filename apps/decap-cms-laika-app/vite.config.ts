import { cloudflare } from '@cloudflare/vite-plugin';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config for the Decap CMS Laika shell.
 *
 * - `@tanstack/router-plugin/vite` regenerates `src/client/routeTree.gen.ts`
 *   from the file-based routes under `src/client/routes/`.
 * - `@vitejs/plugin-react` hooks up Fast Refresh.
 * - `@cloudflare/vite-plugin` mounts the Hono worker at `src/server/index.ts`
 *   in front of the SPA so `wrangler deploy` and `vite dev` behave the same.
 */
export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: 'src/client/routes',
      generatedRouteTree: 'src/client/routeTree.gen.ts',
    }),
    react(),
    cloudflare(),
  ],
  build: {
    outDir: 'dist/client',
    sourcemap: true,
  },
  server: {
    port: 3200,
  },
});
