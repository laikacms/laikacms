import type { StorageContractCase } from 'laikacms/storage/testing';

import { type AlgoliaRecord, PARENT_ATTR } from '../algolia-datasource.js';
import { AlgoliaStorageRepository } from '../algolia-storage-repository.js';

const APP_ID = 'app';
const API_KEY = 'admin-key';
const INDEX = 'laika-storage';
const API_URL = 'https://mock.algolia.test';

const createMockAlgolia = () => {
  const records = new Map<string, AlgoliaRecord>();

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const parseParents = (params: string): string | null => {
    const decoded = new URLSearchParams(params).get('filters') ?? '';
    const match = decoded.match(/^_parent:"([^"]*)"$/);
    return match ? match[1] : null;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const prefix = `/1/indexes/${INDEX}`;
    if (!url.pathname.startsWith(prefix)) return json({ message: 'bad index' }, { status: 404 });
    const rest = url.pathname.slice(prefix.length);

    const hdrs = (init?.headers as Record<string, string> | undefined) ?? {};
    if (hdrs['X-Algolia-Application-Id'] !== APP_ID || hdrs['X-Algolia-API-Key'] !== API_KEY) {
      return json({ message: 'bad auth' }, { status: 401 });
    }

    const recordMatch = rest.match(/^\/(.+)$/);
    if (recordMatch && rest !== '/query' && rest !== '/deleteByQuery') {
      const objectID = decodeURIComponent(recordMatch[1]);
      if (method === 'GET') {
        const record = records.get(objectID);
        if (!record) return json({ message: 'ObjectID does not exist' }, { status: 404 });
        return json(record);
      }
      if (method === 'PUT') {
        const body = JSON.parse((init?.body as string) ?? '{}') as AlgoliaRecord;
        records.set(objectID, body);
        return json({ objectID, taskID: Math.floor(Math.random() * 1000) });
      }
      if (method === 'DELETE') {
        records.delete(objectID);
        return json({ taskID: Math.floor(Math.random() * 1000) });
      }
    }

    if (rest === '/query' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as { params: string };
      const parent = parseParents(body.params ?? '');
      if (parent === null) return json({ message: 'unsupported filter' }, { status: 400 });
      const hits = [...records.values()].filter(r => r[PARENT_ATTR] === parent);
      return json({ hits, nbPages: 1, page: 0, nbHits: hits.length });
    }

    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { records, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
});

export const algoliaContractCase: StorageContractCase = {
  name: 'AlgoliaStorageRepository',
  makeRepo() {
    const mock = createMockAlgolia();
    return new AlgoliaStorageRepository({
      auth: { applicationId: APP_ID, apiKey: API_KEY },
      indexName: INDEX,
      apiUrl: API_URL,
      fetch: mock.fetch,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
