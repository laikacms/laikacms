import { describe, it } from 'vitest';

import { runAssetsRepositoryContract } from './contract.js';
import { assetsContractRegistry } from './registry.js';

if (assetsContractRegistry.length === 0) {
  describe('AssetsRepository contract (no implementations registered)', () => {
    it.todo('register an AssetsContractCase in assetsContractRegistry to run contract tests');
  });
} else {
  for (const tc of assetsContractRegistry) runAssetsRepositoryContract(tc);
}
