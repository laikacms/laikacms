import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The `laikacms/*` workspace package exports point to `./dist/*` which is not
 * built during test runs. Alias each used subpath to its TypeScript source so
 * Vitest can resolve and transform it directly.
 *
 * `@laikacms/decap-cms` is installed as a devDependency and resolves normally —
 * no aliases needed for it. The vi.mock() calls in the test files mock its
 * subpaths (`/lib-util`, `/lib-auth`, `/ui-default`) so the browser-only code
 * that calls `window` at module load time is never executed in tests.
 */
const laikacmsSrc = path.resolve(import.meta.dirname, '../laikacms/src');

export default defineConfig({
  resolve: {
    alias: {
      'laikacms/core': path.join(laikacmsSrc, 'shared/core/index.ts'),
      'laikacms/crypto': path.join(laikacmsSrc, 'shared/crypto/index.ts'),
      'laikacms/assets/api': path.join(laikacmsSrc, 'api/assets-api/index.ts'),
      'laikacms/assets/jsonapi-proxy': path.join(laikacmsSrc, 'impl/assets-jsonapi-proxy/index.ts'),
      'laikacms/documents/jsonapi-proxy': path.join(laikacmsSrc, 'impl/documents-jsonapi-proxy/index.ts'),
      'laikacms/documents/api': path.join(laikacmsSrc, 'api/documents-api/index.ts'),
      'laikacms/storage/api': path.join(laikacmsSrc, 'api/storage-api/index.ts'),
      'laikacms/storage': path.join(laikacmsSrc, 'domain/storage/index.ts'),
      'laikacms/json-api': path.join(laikacmsSrc, 'shared/json-api/index.ts'),
      'laikacms/assets': path.join(laikacmsSrc, 'domain/assets/index.ts'),
      'laikacms/documents': path.join(laikacmsSrc, 'domain/documents/index.ts'),
    },
  },
  test: {
    // Only run the source tests; never the stale compiled copies under dist/.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
