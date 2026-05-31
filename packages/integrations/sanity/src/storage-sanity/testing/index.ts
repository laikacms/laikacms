import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { type SanityDocument, type SanityMutation } from '../sanity-datasource.js';
import { SanityStorageRepository } from '../sanity-storage-repository.js';

const PROJECT = 'proj';
const DATASET = 'production';
const API_URL = `https://mock.sanity.test`;
const API_VERSION = 'v2024-09-01';

interface StoredDoc extends SanityDocument {
  _rev: string;
}

const createMockSanity = () => {
  const docs = new Map<string, StoredDoc>();
  let revCounter = 0;
  const newRev = (): string => `rev-${++revCounter}`;

  const matchDocs = (predicate: (doc: StoredDoc) => boolean): StoredDoc[] => [...docs.values()].filter(predicate);

  const runQuery = (query: string, params: Record<string, unknown>): StoredDoc[] => {
    const q = query.trim();
    if (q === `*[_type == $type && parent == $parent && name in $names][0..1]`) {
      const names = params['names'] as string[];
      return matchDocs(
        d => d._type === params['type'] && d.parent === params['parent'] && names.includes(String(d.name)),
      ).slice(0, 2);
    }
    if (q === `*[_type == $type && parent == $parent && name == $name][0..0]`) {
      return matchDocs(
        d => d._type === params['type'] && d.parent === params['parent'] && d.name === params['name'],
      ).slice(0, 1);
    }
    if (
      q
        === `*[(_type == $folder || _type == $file) && parent == $parent && (name == $name || name match $namePattern)][0..0]`
    ) {
      const pattern = params['namePattern'] as string;
      const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return matchDocs(d =>
        (d._type === params['folder'] || d._type === params['file'])
        && d.parent === params['parent']
        && (d.name === params['name'] || re.test(String(d.name)))
      ).slice(0, 1);
    }
    if (q === `*[(_type == $folder || _type == $file) && parent == $parent][0..0]`) {
      return matchDocs(d =>
        (d._type === params['folder'] || d._type === params['file'])
        && d.parent === params['parent']
      ).slice(0, 1);
    }
    if (q === `*[(_type == $folder || _type == $file) && parent == $parent]`) {
      return matchDocs(d =>
        (d._type === params['folder'] || d._type === params['file'])
        && d.parent === params['parent']
      );
    }
    if (q === `*[_type == $type && path == $path][0..0]`) {
      return matchDocs(d => d._type === params['type'] && d.path === params['path']).slice(0, 1);
    }
    throw new Error(`unhandled GROQ query in mock: ${q}`);
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();

    const queryPath = `/${API_VERSION}/data/query/${DATASET}`;
    const mutatePath = `/${API_VERSION}/data/mutate/${DATASET}`;

    if (url.pathname === queryPath && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        query: string,
        params?: Record<string, unknown>,
      };
      try {
        const result = runQuery(body.query, body.params ?? {});
        return new Response(JSON.stringify({ result, ms: 0, query: body.query }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({ error: { description: (error as Error).message } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    if (url.pathname === mutatePath && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as { mutations: SanityMutation[] };
      const results: Array<{ id: string, operation: string }> = [];
      for (const mutation of body.mutations) {
        if ('create' in mutation) {
          const doc = mutation.create;
          if (docs.has(doc._id)) {
            return new Response(
              JSON.stringify({ error: { description: `Document ${doc._id} already exists` } }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            );
          }
          const now = new Date().toISOString();
          docs.set(doc._id, { ...doc, _createdAt: now, _updatedAt: now, _rev: newRev() } as StoredDoc);
          results.push({ id: doc._id, operation: 'create' });
        } else if ('createIfNotExists' in mutation) {
          const doc = mutation.createIfNotExists;
          if (!docs.has(doc._id)) {
            const now = new Date().toISOString();
            docs.set(doc._id, { ...doc, _createdAt: now, _updatedAt: now, _rev: newRev() } as StoredDoc);
          }
          results.push({ id: doc._id, operation: 'create' });
        } else if ('createOrReplace' in mutation) {
          const doc = mutation.createOrReplace;
          const existing = docs.get(doc._id);
          const now = new Date().toISOString();
          docs.set(doc._id, {
            ...doc,
            _createdAt: existing?._createdAt ?? now,
            _updatedAt: now,
            _rev: newRev(),
          } as StoredDoc);
          results.push({ id: doc._id, operation: 'createOrReplace' });
        } else if ('patch' in mutation) {
          const { id, set, ifRevisionID } = mutation.patch;
          const existing = docs.get(id);
          if (!existing) {
            return new Response(
              JSON.stringify({ error: { description: `Document ${id} not found` } }),
              { status: 404, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (ifRevisionID && existing._rev !== ifRevisionID) {
            return new Response(
              JSON.stringify({ error: { description: 'Revision mismatch' } }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            );
          }
          docs.set(id, {
            ...existing,
            ...(set ?? {}),
            _updatedAt: new Date().toISOString(),
            _rev: newRev(),
          });
          results.push({ id, operation: 'update' });
        } else if ('delete' in mutation) {
          docs.delete(mutation.delete.id);
          results.push({ id: mutation.delete.id, operation: 'delete' });
        }
      }
      return new Response(JSON.stringify({ transactionId: `tx-${revCounter}`, results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { docs, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const sanityContractCase: StorageContractCase = {
  name: 'SanityStorageRepository',
  async makeRepo() {
    const mock = createMockSanity();
    return new SanityStorageRepository({
      projectId: PROJECT,
      dataset: DATASET,
      auth: { token: 'sanity-test' },
      apiUrl: API_URL,
      apiVersion: API_VERSION,
      fetch: mock.fetch,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
