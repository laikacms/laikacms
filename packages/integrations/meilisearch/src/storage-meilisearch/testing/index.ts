import type { StorageContractCase } from 'laikacms/storage/testing';

import { MeiliDataSource, type MeiliDocument } from '../meilisearch-datasource.js';
import { MeiliStorageRepository } from '../meilisearch-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory MeiliSearch mock — per-instance state so every makeRepo() call
// gets a fully isolated index store. Tasks always succeed immediately.
// ---------------------------------------------------------------------------

const API = 'https://meilisearch.contract.test:7700';
const API_KEY = 'meili_contract_test';
const expectedAuth = `Bearer ${API_KEY}`;

interface Index {
  primaryKey: string;
  filterableAttributes: string[];
  documents: Map<string, MeiliDocument>;
}

type Predicate = (doc: MeiliDocument) => boolean;

const parseFilter = (filter: string): Predicate => {
  const clauses = filter.split(/\s+AND\s+/);
  const predicates: Predicate[] = [];
  for (const clause of clauses) {
    const m = clause.match(/^(\w+)\s*=\s*"((?:\\.|[^"\\])*)"$/);
    if (!m) throw new Error(`mock: unrecognised filter clause: ${clause}`);
    const [, field, raw] = m;
    const value = raw!.replace(/\\(.)/g, '$1');
    predicates.push(doc => String((doc as unknown as Record<string, unknown>)[field!] ?? '') === value);
  }
  return doc => predicates.every(p => p(doc));
};

const createMockMeili = () => {
  const indexes = new Map<string, Index>();
  let nextTaskUid = 0;
  const completedTasks = new Set<number>();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (!url.startsWith(API)) return new Response('not found', { status: 404 });
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    if (auth !== expectedAuth) return new Response(JSON.stringify({ code: 'invalid_api_key' }), { status: 401 });
    const u = new URL(url);
    const path = u.pathname;

    const enqueueTask = () => {
      const taskUid = nextTaskUid++;
      completedTasks.add(taskUid);
      return taskUid;
    };

    let m = path.match(/^\/indexes\/([^/]+)$/);
    if (m && method === 'GET') {
      const uid = decodeURIComponent(m[1]!);
      if (!indexes.has(uid)) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
      return new Response(JSON.stringify({ uid, primaryKey: indexes.get(uid)!.primaryKey }), { status: 200 });
    }

    if (path === '/indexes' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { uid: string, primaryKey: string };
      if (!indexes.has(body.uid)) {
        indexes.set(body.uid, { primaryKey: body.primaryKey, filterableAttributes: [], documents: new Map() });
      }
      const taskUid = enqueueTask();
      return new Response(
        JSON.stringify({
          taskUid,
          indexUid: body.uid,
          status: 'enqueued',
          type: 'indexCreation',
          enqueuedAt: new Date().toISOString(),
        }),
        { status: 202 },
      );
    }

    m = path.match(/^\/indexes\/([^/]+)\/documents$/);
    if (m && method === 'PUT') {
      const uid = decodeURIComponent(m[1]!);
      const index = indexes.get(uid);
      if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
      const docs = JSON.parse(init?.body as string) as MeiliDocument[];
      for (const doc of docs) index.documents.set(doc.id, doc);
      const taskUid = enqueueTask();
      return new Response(
        JSON.stringify({
          taskUid,
          indexUid: uid,
          status: 'enqueued',
          type: 'documentAdditionOrUpdate',
          enqueuedAt: new Date().toISOString(),
        }),
        { status: 202 },
      );
    }

    m = path.match(/^\/indexes\/([^/]+)\/documents\/delete-batch$/);
    if (m && method === 'POST') {
      const uid = decodeURIComponent(m[1]!);
      const index = indexes.get(uid);
      if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
      const ids = JSON.parse(init?.body as string) as string[];
      for (const id of ids) index.documents.delete(id);
      const taskUid = enqueueTask();
      return new Response(
        JSON.stringify({
          taskUid,
          indexUid: uid,
          status: 'enqueued',
          type: 'documentDeletion',
          enqueuedAt: new Date().toISOString(),
        }),
        { status: 202 },
      );
    }

    m = path.match(/^\/indexes\/([^/]+)\/search$/);
    if (m && method === 'POST') {
      const uid = decodeURIComponent(m[1]!);
      const index = indexes.get(uid);
      if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
      const body = JSON.parse(init?.body as string) as { filter?: string, limit?: number };
      let docs = [...index.documents.values()];
      if (body.filter) {
        const pred = parseFilter(body.filter);
        docs = docs.filter(pred);
      }
      const limit = body.limit ?? 20;
      return new Response(
        JSON.stringify({ hits: docs.slice(0, limit), estimatedTotalHits: docs.length }),
        { status: 200 },
      );
    }

    m = path.match(/^\/indexes\/([^/]+)\/documents\/([^/]+)$/);
    if (m && method === 'GET') {
      const uid = decodeURIComponent(m[1]!);
      const id = decodeURIComponent(m[2]!);
      const index = indexes.get(uid);
      if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
      const doc = index.documents.get(id);
      if (!doc) return new Response(JSON.stringify({ code: 'document_not_found' }), { status: 404 });
      return new Response(JSON.stringify(doc), { status: 200 });
    }

    m = path.match(/^\/indexes\/([^/]+)\/settings\/filterable-attributes$/);
    if (m && method === 'PUT') {
      const uid = decodeURIComponent(m[1]!);
      const index = indexes.get(uid);
      if (!index) return new Response(JSON.stringify({ code: 'index_not_found' }), { status: 404 });
      const attrs = JSON.parse(init?.body as string) as string[];
      index.filterableAttributes = attrs;
      const taskUid = enqueueTask();
      return new Response(
        JSON.stringify({
          taskUid,
          indexUid: uid,
          status: 'enqueued',
          type: 'settingsUpdate',
          enqueuedAt: new Date().toISOString(),
        }),
        { status: 202 },
      );
    }

    m = path.match(/^\/tasks\/(\d+)$/);
    if (m && method === 'GET') {
      const taskUid = Number(m[1]);
      if (completedTasks.has(taskUid)) {
        return new Response(
          JSON.stringify({ uid: taskUid, status: 'succeeded', type: 'unknown', enqueuedAt: new Date().toISOString() }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }

    return new Response('not found', { status: 404 });
  };

  return fetchImpl;
};

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

export const meilisearchContractCase: StorageContractCase = {
  name: 'MeiliStorageRepository',
  async makeRepo(): Promise<MeiliStorageRepository> {
    const fetchImpl = createMockMeili();
    const ds = new MeiliDataSource({
      url: API,
      auth: { apiKey: API_KEY },
      fetch: fetchImpl,
      taskTimeoutMs: 2000,
      taskPollIntervalMs: 0,
    });
    return new MeiliStorageRepository({
      dataSource: ds,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
