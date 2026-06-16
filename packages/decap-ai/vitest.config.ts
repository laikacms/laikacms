import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages from source since they aren't built in worktrees
      'laikacms/core': path.resolve(__dirname, '../laikacms/src/shared/core/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
