import { describe, it } from 'vitest';

import { runStorageRepositoryContract } from './contract.js';
import { storageContractRegistry } from './registry.js';

if (storageContractRegistry.length === 0) {
  describe('StorageRepository contract (no implementations registered)', () => {
    it.todo('register a StorageContractCase in storageContractRegistry to run contract tests');
  });
} else {
  for (const tc of storageContractRegistry) runStorageRepositoryContract(tc);
}
