import { defineConfig } from 'vitest/config';

/**
 * The v4.beta port imports from `@laikacms/decap-cms/*`, which consolidates the
 * former standalone `decap-cms-*` packages into a single package with subpath
 * exports. Until `@laikacms/decap-cms` is published and installable, resolve each
 * subpath to its still-installed `decap-cms-*` equivalent at runtime so tests
 * run against the real implementations. The tsconfig `paths` provide the
 * matching type resolution for `tsc`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@laikacms/decap-cms/core': 'decap-cms-core',
      '@laikacms/decap-cms/ui-default': 'decap-cms-ui-default',
      '@laikacms/decap-cms/lib-auth': 'decap-cms-lib-auth',
      '@laikacms/decap-cms/lib-util': 'decap-cms-lib-util',
    },
  },
  test: {
    // Only run the source tests; never the stale compiled copies under dist/.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
