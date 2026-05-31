import { vi } from 'vitest';

import { buildJsonApi } from '../../api/storage-api/server.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';
import { type StorageContractCase, storageContractRegistry } from '../../domain/storage/testing/index.js';

import { StorageJsonApiProxyRepository } from './storage-jsonapi-proxy-repository.js';

const ORIGIN = 'http://laika-storage.test';

let originalFetch: typeof fetch | null = null;

export const jsonApiProxyStorageContractCase: StorageContractCase = {
  name: 'StorageJsonApiProxyRepository (in-process JSON:API + in-memory backing)',
  /**
   * The current storage JSON:API server has no `POST /atoms` route for folder
   * creation, and its `/operations` atomic remove path resolves ops but never
   * surfaces the resulting `atom` rows back to the client — so the proxy sees
   * `atomic:results: []` and can't report removed/skipped counts. These are
   * documented server-side gaps, not proxy bugs.
   */
  skip: ['createFolder', 'getAtom', 'removeAtoms'],
  makeRepo: async () => {
    const backing = new InMemoryStorageRepository();
    const api = buildJsonApi({ repo: backing });

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

storageContractRegistry.push(jsonApiProxyStorageContractCase);
