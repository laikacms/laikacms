import { fileURLToPath } from 'node:url';

import { cloudflare } from '@cloudflare/vite-plugin';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const vendorDist = fileURLToPath(new URL('./.vendor/laikacms-decap/dist', import.meta.url));

/**
 * Vite config for the Decap CMS Laika shell.
 *
 * - `@tanstack/router-plugin/vite` regenerates `src/client/routeTree.gen.ts`
 *   from the file-based routes under `src/client/routes/`.
 * - `@vitejs/plugin-react` hooks up Fast Refresh.
 * - `@cloudflare/vite-plugin` mounts the Hono worker at `src/server/index.ts`
 *   in front of the SPA so `wrangler deploy` and `vite dev` behave the same.
 *
 * `@laikacms/decap/*` is aliased into the vendor checkout populated by
 * `pnpm setup:vendor` (see `scripts/setup-vendor.mjs`). We can't depend on
 * the fork as a regular npm dep because its `package.json` uses pnpm
 * `catalog:*` specifiers.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@laikacms\/decap\/(.+)$/, replacement: `${vendorDist}/$1/index.js` },
      { find: /^@laikacms\/decap$/, replacement: `${vendorDist}/app/index.js` },
    ],
  },
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
