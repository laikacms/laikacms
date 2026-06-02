import { describe, it } from 'vitest';

import { runDocumentsRepositoryContract } from './contract.js';
import { documentsContractRegistry } from './registry.js';

if (documentsContractRegistry.length === 0) {
  describe('DocumentsRepository contract (no implementations registered)', () => {
    it.todo('register a DocumentsContractCase in documentsContractRegistry to run contract tests');
  });
} else {
  for (const tc of documentsContractRegistry) runDocumentsRepositoryContract(tc);
}
