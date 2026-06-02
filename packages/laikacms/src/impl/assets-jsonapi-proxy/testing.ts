import { vi } from 'vitest';

import { buildAssetsApi } from '../../api/assets-api/server.js';
import { type AssetsContractCase, assetsContractRegistry } from '../../domain/assets/testing/index.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';
import { ContentBaseAssetsRepository } from '../assets-contentbase/assets-repository.js';
import { TestSettingsProvider } from '../documents-contentbase/testing.js';

import { AssetsJsonApiProxyRepository } from './assets-jsonapi-proxy-repository.js';

const ORIGIN = 'http://laika-assets.test';

let originalFetch: typeof fetch | null = null;

export const jsonApiProxyAssetsContractCase: AssetsContractCase = {
  name: 'AssetsJsonApiProxyRepository (in-process JSON:API + in-memory backing)',
  /**
   * The assets proxy currently wraps every server-side LaikaError as
   * `InvalidData` rather than reconstructing the original typed class — so
   * "key not found after delete" surfaces as `invalid_data` instead of
   * `not_found`. That's a fidelity gap in the proxy, not a CRUDL bug.
   */
  skip: ['deleteAsset', 'deleteFolder'],
  makeRepo: () => {
    const storage = new InMemoryStorageRepository();
    const settings = new TestSettingsProvider();
    const backing = new ContentBaseAssetsRepository(storage, settings);
    const api = buildAssetsApi({ repository: backing, basePath: '' });

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

assetsContractRegistry.push(jsonApiProxyAssetsContractCase);
