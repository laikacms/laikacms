import { vi } from 'vitest';

import { buildAssetsApi } from '../../api/assets-api/server.js';
import type { AssetsContractCase } from '../../domain/assets/testing/index.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';
import { ContentBaseAssetsRepository } from '../assets-contentbase/assets-repository.js';
import { TestSettingsProvider } from '../documents-contentbase/testing.js';

import { AssetsJsonApiProxyRepository } from './assets-jsonapi-proxy-repository.js';

const ORIGIN = 'http://laika-assets.test';

let originalFetch: typeof fetch | null = null;

export const jsonApiProxyAssetsContractCase: AssetsContractCase = {
  name: 'AssetsJsonApiProxyRepository (in-process JSON:API + in-memory backing)',
  /**
   * `deleteAsset`/`deleteFolder` in-process backing throws a `NotFoundError`
   * that fails `instanceof LaikaError` against the JSON:API layer's
   * `errorToJsonApiMapper` in this test's module graph (a dual-module-
   * instance mismatch on `laikacms/core`, unrelated to LCMS-287's proxy
   * rehydration fix) — the server flattens it to a generic 500 before the
   * proxy ever sees a `code`. See LCMS-287 PR discussion.
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
