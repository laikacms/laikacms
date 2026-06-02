import { type AssetsContractCase, assetsContractRegistry } from '../../domain/assets/testing/index.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';
import { TestSettingsProvider } from '../documents-contentbase/testing.js';

import { ContentBaseAssetsRepository } from './assets-repository.js';

export const contentBaseAssetsContractCase: AssetsContractCase = {
  name: 'ContentBaseAssetsRepository (over in-memory storage)',
  makeRepo: () => {
    const storage = new InMemoryStorageRepository();
    const settings = new TestSettingsProvider();
    return new ContentBaseAssetsRepository(storage, settings);
  },
};

assetsContractRegistry.push(contentBaseAssetsContractCase);
