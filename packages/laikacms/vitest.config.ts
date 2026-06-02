import { defineConfig } from 'vitest/config';

/**
 * Pulls in every impl's `testing.ts` once before any contract test file
 * evaluates — the impls self-register cases into the per-domain registries
 * (`storageContractRegistry`, `documentsContractRegistry`, `assetsContractRegistry`).
 *
 * Without this, the domain-level `contract.test.ts` files would see empty
 * registries and emit `it.todo` placeholders.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/__tests__/contracts-setup.ts'],
    passWithNoTests: false,
    testTimeout: 20_000,
  },
});
