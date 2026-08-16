import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The `laikacms/*` workspace package exports point to `./dist/*` which is not
 * built during test runs. Alias each used subpath to its TypeScript source so
 * Vitest can resolve and transform it directly.
 */
const laikacmsSrc = path.resolve(import.meta.dirname, '../laikacms/src');

export default defineConfig({
  resolve: {
    alias: {
      'laikacms/core': path.join(laikacmsSrc, 'shared/core/index.ts'),
      'laikacms/crypto': path.join(laikacmsSrc, 'shared/crypto/index.ts'),
      'laikacms/auth': path.join(laikacmsSrc, 'shared/auth/index.ts'),
      'laikacms/locks/in-process': path.join(laikacmsSrc, 'impl/locks-in-process/index.ts'),
      'laikacms/assets/api': path.join(laikacmsSrc, 'api/assets-api/index.ts'),
      'laikacms/documents/api': path.join(laikacmsSrc, 'api/documents-api/index.ts'),
      'laikacms/storage/api': path.join(laikacmsSrc, 'api/storage-api/index.ts'),
      'laikacms/storage': path.join(laikacmsSrc, 'domain/storage/index.ts'),
      'laikacms/json-api': path.join(laikacmsSrc, 'shared/json-api/index.ts'),
      'laikacms/assets': path.join(laikacmsSrc, 'domain/assets/index.ts'),
      'laikacms/documents': path.join(laikacmsSrc, 'domain/documents/index.ts'),
      'laikacms/catalog': path.join(laikacmsSrc, 'domain/catalog/index.ts'),
      'laikacms/assets-catalog': path.join(laikacmsSrc, 'impl/assets-catalog/index.ts'),
      'laikacms/catalog-decap': path.join(laikacmsSrc, 'impl/catalog-decap/index.ts'),
      'laikacms/compat': path.join(laikacmsSrc, 'shared/core/compat.ts'),
      'laikacms/documents-catalog': path.join(laikacmsSrc, 'impl/documents-catalog/index.ts'),
      'laikacms/storage-fs': path.join(laikacmsSrc, 'impl/storage-fs/index.ts'),
      'laikacms/storage/fs': path.join(laikacmsSrc, 'impl/storage-fs/index.ts'),
      'laikacms/storage-serializers-json': path.join(laikacmsSrc, 'serializers/storage-serializers-json/index.ts'),
      'laikacms/storage-serializers-markdown': path.join(
        laikacmsSrc,
        'serializers/storage-serializers-markdown/index.ts',
      ),
      'laikacms/storage-serializers-raw': path.join(laikacmsSrc, 'serializers/storage-serializers-raw/index.ts'),
      'laikacms/storage-serializers-yaml': path.join(laikacmsSrc, 'serializers/storage-serializers-yaml/index.ts'),
      'laikacms/serializers/yaml': path.join(laikacmsSrc, 'serializers/storage-serializers-yaml/index.ts'),
    },
  },
  test: {
    // Only run the source tests; never the stale compiled copies under dist/.
    include: ['src/**/*.test.ts'],
  },
});
