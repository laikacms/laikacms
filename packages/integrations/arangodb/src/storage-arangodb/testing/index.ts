import type { StorageContractCase } from 'laikacms/storage/testing';

import { type ArangoCursorResponse, ArangoDataSource } from '../arango-datasource.js';
import { ArangoStorageRepository } from '../arango-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory ArangoDB mock — stateful Map-based store per makeRepo() call.
// Handles the three HTTP surface areas the datasource uses:
//   POST /_db/{db}/_api/cursor              → AQL queries
//   POST /_db/{db}/_api/document/{coll}     → document upsert
//   GET  /_db/{db}/_api/document/{coll}/{k} → document fetch by _key
// ---------------------------------------------------------------------------

const DB = 'test-db';
const API = 'https://arango.test:8529';

interface StoredDoc {
  _key: string;
  _id: string;
  _rev: string;
  [key: string]: unknown;
}

const createMockArangoDB = () => {
  const collections = new Map<string, Map<string, StoredDoc>>();
  let revCounter = 0;
  const nextRev = (): string => `_${(++revCounter).toString(36)}`;

  const ensureCollection = (name: string): Map<string, StoredDoc> => {
    let coll = collections.get(name);
    if (!coll) {
      coll = new Map();
      collections.set(name, coll);
    }
    return coll;
  };

  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

  const evalAql = (query: string, bindVars: Record<string, unknown>): unknown[] => {
    const q = norm(query);

    // findFileRecord: FOR doc IN <coll> FILTER doc.type == @type AND doc.parent == @parent AND doc.name == @name LIMIT 1 RETURN doc
    let m = q.match(
      /^FOR doc IN (\w+) FILTER doc\.type == @type AND doc\.parent == @parent AND doc\.name == @name LIMIT 1 RETURN doc$/,
    );
    if (m) {
      const coll = collections.get(m[1]!);
      if (!coll) return [];
      const found = [...coll.values()].find(
        d => d['type'] === bindVars['type'] && d['parent'] === bindVars['parent'] && d['name'] === bindVars['name'],
      );
      return found ? [found] : [];
    }

    // Probe: any doc (root existence check)
    m = q.match(/^FOR doc IN (\w+) LIMIT 1 RETURN doc$/);
    if (m) {
      const coll = collections.get(m[1]!);
      return coll && coll.size > 0 ? [{ probe: true }] : [];
    }

    // Probe: any descendant (child presence check)
    m = q.match(/^FOR doc IN (\w+) FILTER doc\.parent == @parent LIMIT 1 RETURN doc$/);
    if (m) {
      const coll = collections.get(m[1]!);
      if (!coll) return [];
      const found = [...coll.values()].find(d => d['parent'] === bindVars['parent']);
      return found ? [found] : [];
    }

    // INSERT @doc INTO <coll> RETURN NEW
    m = q.match(/^INSERT @doc INTO (\w+) RETURN NEW$/);
    if (m) {
      const collName = m[1]!;
      const doc = bindVars['doc'] as StoredDoc;
      const coll = ensureCollection(collName);
      if (coll.has(doc._key)) {
        throw Object.assign(new Error(`unique constraint violated for ${doc._key}`), {
          status: 409,
          errorNum: 1210,
        });
      }
      const stored: StoredDoc = { ...doc, _id: `${collName}/${doc._key}`, _rev: nextRev() };
      coll.set(doc._key, stored);
      return [stored];
    }

    // UPDATE @key WITH @changes IN <coll> RETURN NEW
    m = q.match(/^UPDATE @key WITH @changes IN (\w+) RETURN NEW$/);
    if (m) {
      const coll = collections.get(m[1]!);
      if (!coll) return [];
      const key = String(bindVars['key']);
      const existing = coll.get(key);
      if (!existing) return [];
      const updated: StoredDoc = { ...existing, ...(bindVars['changes'] as Partial<StoredDoc>), _rev: nextRev() };
      coll.set(key, updated);
      return [updated];
    }

    // Bulk delete: FOR doc IN <coll> FILTER doc.path IN @paths REMOVE doc IN <coll> RETURN OLD._key
    m = q.match(/^FOR doc IN (\w+) FILTER doc\.path IN @paths REMOVE doc IN \w+ RETURN OLD\._key$/);
    if (m) {
      const coll = collections.get(m[1]!);
      if (!coll) return [];
      const paths = (bindVars['paths'] as string[]) ?? [];
      const deleted: string[] = [];
      for (const [key, doc] of coll) {
        if (paths.includes(doc['path'] as string)) {
          coll.delete(key);
          deleted.push(key);
        }
      }
      return deleted;
    }

    // List children: FOR doc IN <coll> FILTER doc.parent == @parent RETURN doc
    m = q.match(/^FOR doc IN (\w+) FILTER doc\.parent == @parent RETURN doc$/);
    if (m) {
      const coll = collections.get(m[1]!);
      if (!coll) return [];
      return [...coll.values()].filter(d => d['parent'] === bindVars['parent']);
    }

    throw new Error(`arango mock: unrecognised AQL: ${q.slice(0, 200)}`);
  };

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (!url.startsWith(API)) return new Response('not found', { status: 404 });
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = new URL(url);
    const path = u.pathname;

    // POST /_db/{db}/_api/cursor
    if (method === 'POST' && path === `/_db/${DB}/_api/cursor`) {
      const body = JSON.parse(init?.body as string) as { query: string, bindVars?: Record<string, unknown> };
      try {
        const result = evalAql(body.query, body.bindVars ?? {});
        const envelope: ArangoCursorResponse<unknown> = { result, hasMore: false, error: false, code: 200 };
        return new Response(JSON.stringify(envelope), { status: 201 });
      } catch (err) {
        const e = err as Error & { status?: number, errorNum?: number };
        return new Response(
          JSON.stringify({ errorMessage: e.message, errorNum: e.errorNum ?? 1, error: true, code: e.status ?? 500 }),
          { status: e.status ?? 500 },
        );
      }
    }

    // GET /_db/{db}/_api/document/{coll}/{key}
    let m = path.match(/^\/_db\/[^/]+\/_api\/document\/([^/]+)\/([^/]+)$/);
    if (m && method === 'GET') {
      const coll = collections.get(decodeURIComponent(m[1]!));
      if (!coll) return new Response(JSON.stringify({ errorMessage: 'not found' }), { status: 404 });
      const doc = coll.get(decodeURIComponent(m[2]!));
      if (!doc) return new Response(JSON.stringify({ errorMessage: 'not found' }), { status: 404 });
      return new Response(JSON.stringify(doc), { status: 200 });
    }

    // POST /_db/{db}/_api/document/{coll}?overwriteMode=…
    m = path.match(/^\/_db\/[^/]+\/_api\/document\/([^/]+)$/);
    if (m && method === 'POST') {
      const collName = decodeURIComponent(m[1]!);
      const overwrite = u.searchParams.get('overwriteMode') ?? 'conflict';
      const body = JSON.parse(init?.body as string) as StoredDoc;
      const coll = ensureCollection(collName);
      const existing = coll.get(body._key);
      if (existing && overwrite === 'conflict') {
        return new Response(
          JSON.stringify({ errorMessage: 'unique constraint violated', errorNum: 1210, error: true }),
          { status: 409 },
        );
      }
      if (existing && overwrite === 'ignore') {
        return new Response(JSON.stringify({ ...existing, new: existing }), { status: 200 });
      }
      const stored: StoredDoc = { ...body, _id: `${collName}/${body._key}`, _rev: nextRev() };
      coll.set(body._key, stored);
      return new Response(JSON.stringify({ ...stored, new: stored }), { status: 201 });
    }

    return new Response('not found', { status: 404 });
  };

  return { fetch: mockFetch };
};

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

export const arangoContractCase: StorageContractCase = {
  name: 'ArangoStorageRepository',
  async makeRepo() {
    const mock = createMockArangoDB();
    const dataSource = new ArangoDataSource({
      url: API,
      database: DB,
      auth: { bearer: 'test-token' },
      fetch: mock.fetch,
    });
    return new ArangoStorageRepository({
      dataSource,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
