import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The v4.beta port imports from `@laikacms/decap-cms/*`, which consolidates the
 * former standalone `decap-cms-*` packages into a single package with subpath
 * exports. Until `@laikacms/decap-cms` is published and installable, resolve each
 * subpath to its still-installed `decap-cms-*` equivalent at runtime so tests
 * run against the real implementations. The tsconfig `paths` provide the
 * matching type resolution for `tsc`.
 *
 * The `laikacms/*` workspace package exports point to `./dist/*` which is not
 * built during test runs. Alias each used subpath to its TypeScript source so
 * Vitest can resolve and transform it directly.
 */
const laikacmsSrc = path.resolve(import.meta.dirname, '../laikacms/src');

export default defineConfig({
  resolve: {
    alias: {
      '@laikacms/decap-cms/core': 'decap-cms-core',
      '@laikacms/decap-cms/ui-default': 'decap-cms-ui-default',
      '@laikacms/decap-cms/lib-auth': 'decap-cms-lib-auth',
      '@laikacms/decap-cms/lib-util': 'decap-cms-lib-util',
      'laikacms/core': path.join(laikacmsSrc, 'shared/core/index.ts'),
      'laikacms/crypto': path.join(laikacmsSrc, 'shared/crypto/index.ts'),
      'laikacms/assets-api': path.join(laikacmsSrc, 'api/assets-api/index.ts'),
      'laikacms/assets': path.join(laikacmsSrc, 'domain/assets/index.ts'),
    },
  },
  test: {
    // Only run the source tests; never the stale compiled copies under dist/.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
