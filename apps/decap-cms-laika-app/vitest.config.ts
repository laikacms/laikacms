import { defineConfig } from 'vitest/config';

/**
 * Standalone Vitest config so the Cloudflare/TanStack Vite plugins (which
 * spawn a worker dev pool and a route-tree generator) don't run during
 * tests. The unit tests only touch the Hono handler.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
