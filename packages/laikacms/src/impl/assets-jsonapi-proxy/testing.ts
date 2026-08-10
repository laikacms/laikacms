import { vi } from 'vitest';

import { buildAssetsApi } from '../../api/assets-api/server.js';
import type { AssetsContractCase } from '../../domain/assets/testing/index.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';
import { allowAll } from '../../shared/json-api/authorize.js';
import { CatalogAssetsRepository } from '../assets-catalog/assets-repository.js';
import { TestSettingsProvider } from '../documents-catalog/testing.js';

import { AssetsJsonApiProxyRepository } from './assets-jsonapi-proxy-repository.js';

const ORIGIN = 'http://laika-assets.test';

let originalFetch: typeof fetch | null = null;

export const jsonApiProxyAssetsContractCase: AssetsContractCase = {
  name: 'AssetsJsonApiProxyRepository (in-process JSON:API + in-memory backing)',
  makeRepo: () => {
    const storage = new InMemoryStorageRepository();
    const settings = new TestSettingsProvider();
    const backing = new CatalogAssetsRepository(storage, settings);
    const api = buildAssetsApi({ repository: backing, basePath: '', authorize: allowAll });

    originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' || input instanceof URL
          ? new URL(input.toString())
          : new URL(input.url);
        if (url.origin !== ORIGIN) {
          if (!originalFetch) throw new Error('jsonApiProxy stub: no original fetch');
          return originalFetch(input, init);
        }
        const req = input instanceof Request
          ? new Request(input, init)
          : new Request(url.toString(), init);
        return api.fetch(req);
      }) as typeof fetch,
    );

    return new AssetsJsonApiProxyRepository({ baseUrl: ORIGIN });
  },
  teardown: () => {
    vi.unstubAllGlobals();
    originalFetch = null;
  },
};
