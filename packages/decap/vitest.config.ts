import { defineConfig } from 'vitest/config';

/**
 * The v4.beta port imports from `@laikacms/decap/*`, which consolidates the
 * former standalone `decap-cms-*` packages into a single package with subpath
 * exports. Until `@laikacms/decap` is published and installable, resolve each
 * subpath to its still-installed `decap-cms-*` equivalent at runtime so tests
 * run against the real implementations. The tsconfig `paths` provide the
 * matching type resolution for `tsc`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@laikacms/decap/core': 'decap-cms-core',
      '@laikacms/decap/ui-default': 'decap-cms-ui-default',
      '@laikacms/decap/lib-auth': 'decap-cms-lib-auth',
      '@laikacms/decap/lib-util': 'decap-cms-lib-util',
    },
  },
});
