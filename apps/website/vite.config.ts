import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Static SPA for laikacms.com — TanStack Router (file-based), Tailwind v4.
 * Deliberately client-only: no server runtime sits under the apex domain
 * (the deploy story is AWS Lambda + CodeBuild, configured in laika-cloud).
 */
export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: 'src/routes',
      generatedRouteTree: 'src/routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3300,
  },
});
