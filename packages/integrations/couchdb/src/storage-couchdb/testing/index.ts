import type { StorageContractCase } from 'laikacms/storage/testing';

import { CouchDbDataSource, type StorageDoc } from '../couchdb-datasource.js';
import { CouchDbStorageRepository } from '../couchdb-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory CouchDB mock — per-instance state so every makeRepo() call gets
// a fully isolated document store.
// ---------------------------------------------------------------------------

const BASE = 'https://couch.contract.test/cms';
const USER = 'admin';
const PASS = 'password';
const expectedAuth = `Basic ${btoa(`${USER}:${PASS}`)}`;

type Predicate = (doc: StorageDoc) => boolean;

const valueMatches = (docValue: unknown, expected: unknown): boolean => {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    const ops = expected as Record<string, unknown>;
    for (const [op, opVal] of Object.entries(ops)) {
      if (op === '$in' && Array.isArray(opVal)) {
        if (!opVal.includes(docValue)) return false;
      } else if (op === '$eq') {
        if (docValue !== opVal) return false;
      } else {
        throw new Error(`unsupported operator: ${op}`);
      }
    }
    return true;
  }
  return docValue === expected;
};

const makeSelector = (selector: Record<string, unknown>): Predicate => {
  const subs: Predicate[] = [];
  for (const [k, v] of Object.entries(selector)) {
    if (k === '$or' && Array.isArray(v)) {
      const inner = (v as Record<string, unknown>[]).map(makeSelector);
      subs.push(doc => inner.some(p => p(doc)));
    } else if (k === '$and' && Array.isArray(v)) {
      const inner = (v as Record<string, unknown>[]).map(makeSelector);
      subs.push(doc => inner.every(p => p(doc)));
    } else {
      subs.push(doc => valueMatches((doc as unknown as Record<string, unknown>)[k], v));
    }
  }
  return doc => subs.every(p => p(doc));
};

const createMockCouchDb = () => {
  const docs = new Map<string, StorageDoc & { _rev: string }>();
  let revCounter = 0;

  const nextRev = (oldRev?: string): string => {
    revCounter += 1;
    const generation = oldRev ? Number(oldRev.split('-')[0]!) + 1 : 1;
    return `${generation}-mock${revCounter.toString(16).padStart(8, '0')}`;
  };

  const decodeId = (pathRest: string): string => pathRest.split('/').map(decodeURIComponent).join('/');

  const fetchImpl: typeof fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : (input as URL).toString();
    const url = new URL(urlStr);
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    if (auth !== expectedAuth) return new Response('Unauthorized', { status: 401 });

    const path = url.pathname.replace(/^\/cms\/?/, '');

    if (method === 'POST' && path === '_find') {
      const body = JSON.parse(init?.body as string) as {
        selector: Record<string, unknown>,
        limit?: number,
        sort?: Array<Record<string, 'asc' | 'desc'>>,
      };
      const predicate = makeSelector(body.selector);
      const allDocs = [...docs.values()].filter(d => predicate(d));
      if (body.sort) {
        const [sortSpec] = body.sort;
        if (sortSpec) {
          const [[field, dir]] = Object.entries(sortSpec);
          allDocs.sort((a, b) => {
            const va = String((a as unknown as Record<string, unknown>)[field!]);
            const vb = String((b as unknown as Record<string, unknown>)[field!]);
            return (dir === 'desc' ? -1 : 1) * va.localeCompare(vb);
          });
        }
      }
      const limited = allDocs.slice(0, body.limit ?? 25);
      return new Response(JSON.stringify({ docs: limited }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (method === 'POST' && path === '_bulk_docs') {
      const body = JSON.parse(init?.body as string) as {
        docs: Array<Partial<StorageDoc> & { _id: string, _rev?: string, _deleted?: boolean }>,
      };
      const results = body.docs.map(doc => {
        if (doc._deleted) {
          const current = docs.get(doc._id);
          if (!current) return { id: doc._id, error: 'not_found', reason: 'missing' };
          if (current._rev !== doc._rev) {
            return { id: doc._id, error: 'conflict', reason: 'Document update conflict.' };
          }
          docs.delete(doc._id);
          return { id: doc._id, rev: nextRev(current._rev), ok: true };
        }
        const current = docs.get(doc._id);
        if (current && current._rev !== doc._rev) {
          return { id: doc._id, error: 'conflict', reason: 'Document update conflict.' };
        }
        const newRev = nextRev(current?._rev);
        docs.set(doc._id, { ...(doc as StorageDoc), _rev: newRev });
        return { id: doc._id, rev: newRev, ok: true };
      });
      return new Response(JSON.stringify(results), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (path && !path.startsWith('_')) {
      const id = decodeId(path);

      if (method === 'HEAD') {
        const doc = docs.get(id);
        if (!doc) return new Response(null, { status: 404 });
        return new Response(null, { status: 200, headers: { etag: `"${doc._rev}"` } });
      }

      if (method === 'GET') {
        const doc = docs.get(id);
        if (!doc) return new Response('not found', { status: 404 });
        return new Response(JSON.stringify(doc), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (method === 'PUT') {
        const body = JSON.parse(init?.body as string) as Partial<StorageDoc> & { _rev?: string };
        const current = docs.get(id);
        if (current) {
          if (body._rev !== current._rev) {
            return new Response(JSON.stringify({ error: 'conflict', reason: 'Document update conflict.' }), {
              status: 409,
              headers: { 'content-type': 'application/json' },
            });
          }
          const newRev = nextRev(current._rev);
          docs.set(id, { ...(body as StorageDoc), _id: id, _rev: newRev });
          return new Response(JSON.stringify({ id, rev: newRev, ok: true }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        const newRev = nextRev();
        docs.set(id, { ...(body as StorageDoc), _id: id, _rev: newRev });
        return new Response(JSON.stringify({ id, rev: newRev, ok: true }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
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

export const couchdbContractCase: StorageContractCase = {
  name: 'CouchDbStorageRepository',
  async makeRepo(): Promise<CouchDbStorageRepository> {
    const fetchImpl = createMockCouchDb();
    const ds = new CouchDbDataSource({
      auth: { basic: { username: USER, password: PASS } },
      url: BASE,
      fetch: fetchImpl,
    });
    return new CouchDbStorageRepository({
      dataSource: ds,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
