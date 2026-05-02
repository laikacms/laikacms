import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest baseline. Per-package configs should import and extend this so coverage
 * thresholds and reporters stay consistent across the monorepo.
 *
 * Example (packages/shared/crypto/vitest.config.ts):
 *
 *   import { mergeConfig } from "vitest/config";
 *   import base from "../../../vitest.config.base";
 *
 *   export default mergeConfig(base, {
 *     test: { include: ["src/**\/*.test.ts"] },
 *   });
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.spec.ts',
        'src/**/index.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
