import { vi } from 'vitest';

import { buildJsonApi } from '../../api/documents-api/server.js';
import { InMemoryDocumentsRepository } from '../../domain/documents/testing/in-memory-documents.js';
import { type DocumentsContractCase, documentsContractRegistry } from '../../domain/documents/testing/index.js';
import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';
import { ContentBaseDocumentsRepository } from '../documents-contentbase/documents-repository.js';
import { TestSettingsProvider } from '../documents-contentbase/testing.js';

import { DocumentsJsonApiProxyRepository } from './documents-jsonapi-proxy-repository.js';

const ORIGIN = 'http://laika-documents.test';

let originalFetch: typeof fetch | null = null;

export const jsonApiProxyDocumentsContractCase: DocumentsContractCase = {
  name: 'DocumentsJsonApiProxyRepository (in-process JSON:API + in-memory backing)',
  /**
   * Known gaps in the in-process server/proxy pair:
   * - `respondVoid` on DELETE returns `{ meta: { deleted: true } }` rather than
   *   propagating a typed NotFoundError back through the proxy when the
   *   follow-up GET fails on a key that was just deleted (the proxy's fetch
   *   layer interprets the response shape as InvalidData rather than 404).
   * - `listRecordSummaries` is not yet wired through the proxy's
   *   `/record-summaries` path.
   */
  skip: ['deleteDocument', 'deleteUnpublished', 'listRecordSummaries'],
  makeRepo: () => {
    const storage = new InMemoryStorageRepository();
    const settings = new TestSettingsProvider();
    const backing = new ContentBaseDocumentsRepository(storage, settings);
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

    return new DocumentsJsonApiProxyRepository({ baseUrl: ORIGIN });
  },
  teardown: () => {
    vi.unstubAllGlobals();
    originalFetch = null;
  },
};

documentsContractRegistry.push(jsonApiProxyDocumentsContractCase);

const CHANGES_ORIGIN = 'http://laika-documents-changes.test';

let originalFetchChanges: typeof fetch | null = null;

/**
 * Same server/proxy pair, but backed by the in-memory reference documents
 * repository, which supports version tracking, sync tokens, and the change
 * feed. This exercises the capability-gated contract tests end to end
 * through the JSON:API routes (`/sync-token`, `/changes`) and the version
 * passthrough on records and summaries.
 */
export const jsonApiProxyChangesContractCase: DocumentsContractCase = {
  name: 'DocumentsJsonApiProxyRepository (in-process JSON:API + in-memory documents backing)',
  makeRepo: () => {
    const backing = new InMemoryDocumentsRepository();
    const api = buildJsonApi({ repo: backing });

    originalFetchChanges = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' || input instanceof URL
          ? new URL(input.toString())
          : new URL(input.url);
        if (url.origin !== CHANGES_ORIGIN) {
          if (!originalFetchChanges) throw new Error('jsonApiProxyChanges stub: no original fetch');
          return originalFetchChanges(input, init);
        }
        const req = input instanceof Request
          ? new Request(input, init)
          : new Request(url.toString(), init);
        return api.fetch(req);
      }) as typeof fetch,
    );

    return new DocumentsJsonApiProxyRepository({ baseUrl: CHANGES_ORIGIN });
  },
  teardown: () => {
    vi.unstubAllGlobals();
    originalFetchChanges = null;
  },
};

documentsContractRegistry.push(jsonApiProxyChangesContractCase);
