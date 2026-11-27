import { vi } from 'vitest';

import type { DocumentsContractCase } from '../../domain/documents/testing/index.js';
import type { TrailBaseDocumentRow, TrailBaseRevisionRow } from './documents-repository.js';
import { TrailBaseDocumentsRepository } from './documents-repository.js';

const TRAILBASE_ORIGIN = 'http://trailbase.test';
const RECORD_API_BASE = '/api/records/v1';

type AnyRow = Record<string, unknown>;

/** Minimal in-memory simulation of the TrailBase Record API for the documents tables. */
function makeTrailBaseMock() {
  const stores = new Map<string, Map<string, AnyRow>>();
  let idCounter = 0;

  const getStore = (table: string): Map<string, AnyRow> => {
    if (!stores.has(table)) stores.set(table, new Map());
    return stores.get(table)!;
  };

  const matchesFilters = (row: AnyRow, filters: Map<string, string>): boolean => {
    for (const [rawKey, value] of filters) {
      const m = rawKey.match(/^filter\[([^\]]+)\]\[(\$[^\]]+)\]$/);
      if (!m) continue;
      const [, col, op] = m;
      const cell = String(row[col] ?? '');
      if (op === '$eq' && cell !== value) return false;
      if (op === '$ne' && cell === value) return false;
      if (op === '$lte' && Number(cell) > Number(value)) return false;
      if (op === '$like') {
        const pattern = value.replace(/%/g, '.*').replace(/_/g, '.');
        if (!new RegExp(`^${pattern}$`).test(cell)) return false;
      }
    }
    return true;
  };

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);

    if (url.origin !== TRAILBASE_ORIGIN) {
      throw new Error(`trailbase mock: unexpected host ${url.origin}`);
    }

    const pathParts = url.pathname.replace(RECORD_API_BASE + '/', '').split('/');
    const table = decodeURIComponent(pathParts[0]!);
    const rowId = pathParts[1] ? decodeURIComponent(pathParts[1]) : null;
    const method = (init?.method ?? 'GET').toUpperCase();

    const store = getStore(table);

    if (method === 'GET' && !rowId) {
      // List with filters and pagination
      const params = url.searchParams;
      const filters = new Map<string, string>();
      for (const [k, v] of params) {
        if (k.startsWith('filter[')) filters.set(k, v);
      }
      const limit = params.has('limit') ? Number(params.get('limit')) : 100;
      const offset = params.has('offset') ? Number(params.get('offset')) : 0;
      const count = params.get('count') === 'true';

      const all = Array.from(store.values()).filter(r => matchesFilters(r, filters));
      const page = all.slice(offset, offset + limit);

      return new Response(
        JSON.stringify({
          records: page,
          ...(count ? { total_count: all.length } : {}),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (method === 'GET' && rowId) {
      const row = store.get(rowId);
      if (!row) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (method === 'POST') {
      const body = JSON.parse(init?.body as string ?? '{}') as AnyRow;
      const id = `tb-${++idCounter}`;
      const row = { id, ...body };
      store.set(id, row);
      return new Response(JSON.stringify({ ids: [id] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (method === 'PATCH' && rowId) {
      const existing = store.get(rowId);
      if (!existing) return new Response('Not found', { status: 404 });
      const patch = JSON.parse(init?.body as string ?? '{}') as AnyRow;
      store.set(rowId, { ...existing, ...patch });
      return new Response('', { status: 200 });
    }

    if (method === 'DELETE' && rowId) {
      store.delete(rowId);
      return new Response('', { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  };

  return { mockFetch: mockFetch as typeof globalThis.fetch, stores };
}

let originalFetch: typeof globalThis.fetch | null = null;

export const trailbaseDocumentsContractCase: DocumentsContractCase = {
  name: 'TrailBaseDocumentsRepository (mocked TrailBase Record API)',
  makeRepo: () => {
    const { mockFetch } = makeTrailBaseMock();

    originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', mockFetch);

    return new TrailBaseDocumentsRepository({
      baseUrl: TRAILBASE_ORIGIN,
      documentsTable: 'laika_documents',
      revisionsTable: 'laika_revisions',
      fetch: mockFetch,
    });
  },
  teardown: () => {
    vi.unstubAllGlobals();
    originalFetch = null;
  },
};
