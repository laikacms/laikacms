import type { StorageContractCase } from 'laikacms/storage/testing';

import { AtprotoDataSource } from '../atproto-datasource.js';
import { AtprotoStorageRepository } from '../atproto-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory AT Protocol PDS mock — stateful Map-based record store.
// Covers the six XRPC endpoints the datasource uses:
//   GET  /xrpc/com.atproto.repo.getRecord
//   GET  /xrpc/com.atproto.repo.listRecords
//   POST /xrpc/com.atproto.repo.createRecord
//   POST /xrpc/com.atproto.repo.putRecord
//   POST /xrpc/com.atproto.repo.deleteRecord
//   POST /xrpc/com.atproto.repo.applyWrites
// ---------------------------------------------------------------------------

const PDS_URL = 'https://pds.test';
const REPO = 'did:test:mock';
const TOKEN = 'test-jwt';

interface StoredRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

const createMockPDS = () => {
  // Keyed by `<collection>/<rkey>`.
  const records = new Map<string, StoredRecord>();
  let cidCounter = 0;
  const newCid = (): string => `bafycid${(++cidCounter).toString().padStart(10, '0')}`;

  const storeKey = (collection: string, rkey: string): string => `${collection}/${rkey}`;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (!url.startsWith(PDS_URL)) return new Response('not found', { status: 404 });

    const method = (init?.method ?? 'GET').toUpperCase();
    const u = new URL(url);
    const xrpc = u.pathname.replace('/xrpc/', '');

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (xrpc === 'com.atproto.repo.getRecord' && method === 'GET') {
      const collection = u.searchParams.get('collection') ?? '';
      const rkey = u.searchParams.get('rkey') ?? '';
      const record = records.get(storeKey(collection, rkey));
      if (!record) return new Response(JSON.stringify({ error: 'NotFound' }), { status: 404 });
      return json(record);
    }

    if (xrpc === 'com.atproto.repo.listRecords' && method === 'GET') {
      const collection = u.searchParams.get('collection') ?? '';
      const rkeyStart = u.searchParams.get('rkeyStart') ?? '';
      const rkeyEnd = u.searchParams.get('rkeyEnd') ?? '';
      const limit = parseInt(u.searchParams.get('limit') ?? '100', 10);

      const prefix = `${collection}/`;
      const matching: StoredRecord[] = [];
      for (const [key, record] of records) {
        if (!key.startsWith(prefix)) continue;
        const rkey = key.slice(prefix.length);
        if (rkeyStart && rkey < rkeyStart) continue;
        if (rkeyEnd && rkey >= rkeyEnd) continue;
        matching.push(record);
        if (matching.length >= limit) break;
      }
      return json({ records: matching });
    }

    if (xrpc === 'com.atproto.repo.createRecord' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as {
        collection: string,
        rkey: string,
        record: Record<string, unknown>,
      };
      const key = storeKey(body.collection, body.rkey);
      if (records.has(key)) {
        return json({ error: 'RecordAlreadyExists', message: 'record already exists' }, 400);
      }
      const cid = newCid();
      const uri = `at://${REPO}/${body.collection}/${body.rkey}`;
      records.set(key, { uri, cid, value: body.record });
      return json({ uri, cid });
    }

    if (xrpc === 'com.atproto.repo.putRecord' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as {
        collection: string,
        rkey: string,
        record: Record<string, unknown>,
        swapRecord?: string,
      };
      const key = storeKey(body.collection, body.rkey);
      const existing = records.get(key);
      if (body.swapRecord && existing && existing.cid !== body.swapRecord) {
        return json({ error: 'InvalidSwap', message: 'swap record mismatch' }, 400);
      }
      const cid = newCid();
      const uri = existing?.uri ?? `at://${REPO}/${body.collection}/${body.rkey}`;
      records.set(key, { uri, cid, value: body.record });
      return json({ uri, cid });
    }

    if (xrpc === 'com.atproto.repo.deleteRecord' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { collection: string, rkey: string };
      const key = storeKey(body.collection, body.rkey);
      records.delete(key);
      return json({});
    }

    if (xrpc === 'com.atproto.repo.applyWrites' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as {
        writes: Array<{ $type: string, collection: string, rkey: string, value?: Record<string, unknown> }>,
      };
      const results: Array<{ $type: string, uri?: string, cid?: string }> = [];
      for (const write of body.writes) {
        if (write.$type === 'com.atproto.repo.applyWrites#create') {
          const key = storeKey(write.collection, write.rkey);
          if (records.has(key)) {
            return json({ error: 'RecordAlreadyExists' }, 400);
          }
          const cid = newCid();
          const uri = `at://${REPO}/${write.collection}/${write.rkey}`;
          records.set(key, { uri, cid, value: write.value ?? {} });
          results.push({ $type: 'com.atproto.repo.applyWrites#createResult', uri, cid });
        } else if (write.$type === 'com.atproto.repo.applyWrites#update') {
          const key = storeKey(write.collection, write.rkey);
          const cid = newCid();
          const uri = records.get(key)?.uri ?? `at://${REPO}/${write.collection}/${write.rkey}`;
          records.set(key, { uri, cid, value: write.value ?? {} });
          results.push({ $type: 'com.atproto.repo.applyWrites#updateResult', uri, cid });
        } else if (write.$type === 'com.atproto.repo.applyWrites#delete') {
          const key = storeKey(write.collection, write.rkey);
          records.delete(key);
          results.push({ $type: 'com.atproto.repo.applyWrites#deleteResult' });
        }
      }
      return json({ results });
    }

    return new Response(`{"error":"UnknownMethod"}`, { status: 501 });
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

export const atprotoContractCase: StorageContractCase = {
  name: 'AtprotoStorageRepository',
  async makeRepo() {
    const mock = createMockPDS();
    const dataSource = new AtprotoDataSource({
      auth: { accessJwt: TOKEN },
      repo: REPO,
      pdsUrl: PDS_URL,
      fetch: mock.fetch,
    });
    return new AtprotoStorageRepository({
      dataSource,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
