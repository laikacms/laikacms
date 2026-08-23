import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // `expectTypeOf` assertions are inert unless type checking is on, and the
    // ones in astro-compat.test.ts are the only thing standing between us and
    // shipping a loader Astro will not accept.
    typecheck: { enabled: true, include: ['src/**/*.test.ts'] },
  },
});
