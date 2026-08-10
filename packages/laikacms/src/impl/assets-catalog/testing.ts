import type { AssetsContractCase } from '../../domain/assets/testing/index.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';
import { TestSettingsProvider } from '../documents-catalog/testing.js';

import { CatalogAssetsRepository } from './assets-repository.js';

export const catalogAssetsContractCase: AssetsContractCase = {
  name: 'CatalogAssetsRepository (over in-memory storage)',
  makeRepo: () => {
    const storage = new InMemoryStorageRepository();
    const settings = new TestSettingsProvider();
    return new CatalogAssetsRepository(storage, settings);
  },
};
