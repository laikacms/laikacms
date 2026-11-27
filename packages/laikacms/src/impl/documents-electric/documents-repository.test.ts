import { describe, expect, it } from 'vitest';

import { InMemoryDocumentsRepository } from '../../domain/documents/testing/in-memory-documents.js';
import { collectStream } from '../../shared/core/compat.js';

import { type ElectricDocumentRow, ElectricDocumentsRepository } from './documents-repository.js';

const row = (key: string, status = 'published'): ElectricDocumentRow => ({
  key,
  depth: key.split('/').length,
  status,
  language: 'und',
  content: JSON.stringify({ title: key }),
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const insert = (r: ElectricDocumentRow) => ({ key: r.key, value: r, headers: { action: 'insert' } });

describe('ElectricDocumentsRepository shape paging', () => {
  it('follows electric-offset/handle across chunks until up-to-date', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      urls.push(url.search);
      if (url.searchParams.get('offset') === '-1') {
        return new Response(JSON.stringify([insert(row('posts/a'))]), {
          status: 200,
          headers: { 'electric-offset': '0_1', 'electric-handle': 'h1' },
        });
      }
      return new Response(
        JSON.stringify([insert(row('posts/b')), { headers: { control: 'up-to-date' } }]),
        { status: 200, headers: { 'electric-offset': '0_2', 'electric-handle': 'h1' } },
      );
    }) as typeof globalThis.fetch;

    const repo = new ElectricDocumentsRepository({
      baseUrl: 'http://electric.test',
      innerRepo: new InMemoryDocumentsRepository(),
      fetch: fetchImpl,
    });

    const { items } = await collectStream(
      repo.listRecords({ folder: 'posts', depth: 1, type: undefined, pagination: { offset: 0, limit: 10 } }),
    );

    expect(items.map(i => i.key)).toEqual(['posts/a', 'posts/b']);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('offset=0_1');
    expect(urls[1]).toContain('handle=h1');
  });
});
