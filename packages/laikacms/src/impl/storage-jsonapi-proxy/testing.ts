import { vi } from 'vitest';

import { buildJsonApi } from '../../api/storage-api/server.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';
import type { StorageContractCase } from '../../domain/storage/testing/index.js';
import { allowAll } from '../../shared/json-api/authorize.js';

import { StorageJsonApiProxyRepository } from './storage-jsonapi-proxy-repository.js';

const ORIGIN = 'http://laika-storage.test';

let originalFetch: typeof fetch | null = null;

export const jsonApiProxyStorageContractCase: StorageContractCase = {
  name: 'StorageJsonApiProxyRepository (in-process JSON:API + in-memory backing)',
  skip: [],
  makeRepo: async () => {
    const backing = new InMemoryStorageRepository();
    const api = buildJsonApi({ repo: backing, authorize: allowAll });

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

    return new StorageJsonApiProxyRepository({ baseUrl: ORIGIN });
  },
  teardown: async () => {
    vi.unstubAllGlobals();
    originalFetch = null;
  },
};
