import { vi } from 'vitest';

import { pathToSegments } from 'laikacms/documents';
import { InMemoryDocumentsRepository } from '../../domain/documents/testing/in-memory-documents.js';
import type { DocumentsContractCase } from '../../domain/documents/testing/index.js';
import { collectStream } from '../../shared/core/compat.js';

import { ElectricDocumentsRepository } from './documents-repository.js';

const ELECTRIC_ORIGIN = 'http://electric.test';

let originalFetch: typeof globalThis.fetch | null = null;

export const electricDocumentsContractCase: DocumentsContractCase = {
  name: 'ElectricDocumentsRepository (mocked Electric shape endpoint + in-memory write backend)',
  makeRepo: () => {
    const inner = new InMemoryDocumentsRepository();

    originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      (async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === 'string' || input instanceof URL
          ? new URL(input.toString())
          : new URL((input as Request).url);

        if (url.origin !== ELECTRIC_ORIGIN) {
          if (!originalFetch) throw new Error('electric stub: no original fetch');
          return originalFetch(input, _init);
        }

        // InMemoryDocumentsRepository.listRecords with folder=undefined returns
        // folder-level entries (like a filesystem root listing), not documents.
        // We first collect the top-level collection folder names, then fetch
        // docs from each folder so the shape snapshot mirrors all documents.
        const { items: rootItems } = await collectStream(
          inner.listRecords({
            folder: undefined,
            depth: 1,
            type: undefined,
            pagination: { offset: 0, limit: 1000 },
          }),
        );
        const collectionFolders = rootItems
          .filter((r): r is Extract<typeof r, { type: 'folder' }> => r.type === 'folder')
          .map(r => r.key);

        const docRecords: Array<
          {
            key: string,
            status: string,
            language: string,
            content: Record<string, unknown>,
            createdAt?: string,
            updatedAt?: string,
          }
        > = [];
        for (const folder of collectionFolders) {
          const { items } = await collectStream(
            inner.listRecords({
              folder,
              depth: 999,
              type: undefined,
              pagination: { offset: 0, limit: 10000 },
            }),
          );
          for (const r of items) {
            if (r.type === 'published' || r.type === 'unpublished') {
              docRecords.push({
                key: r.key,
                status: r.status,
                language: r.language,
                content: r.content,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
              });
            }
          }
        }

        const messages = [
          ...docRecords.map(record => ({
            key: `id=${encodeURIComponent(record.key)}`,
            value: {
              key: record.key,
              depth: pathToSegments(record.key).length,
              status: record.status,
              language: record.language,
              content: JSON.stringify(record.content),
              created_at: record.createdAt ?? new Date().toISOString(),
              updated_at: record.updatedAt ?? new Date().toISOString(),
            },
            headers: { action: 'insert' as const },
          })),
          { headers: { control: 'up-to-date' } },
        ];

        return new Response(JSON.stringify(messages), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof globalThis.fetch,
    );

    return new ElectricDocumentsRepository({
      baseUrl: ELECTRIC_ORIGIN,
      table: 'laika_documents',
      innerRepo: inner,
    });
  },
  teardown: () => {
    vi.unstubAllGlobals();
    originalFetch = null;
  },
};
