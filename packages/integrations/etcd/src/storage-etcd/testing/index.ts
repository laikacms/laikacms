import type { StorageContractCase } from 'laikacms/storage/testing';

import { EtcdDataSource } from '../etcd-datasource.js';
import { EtcdStorageRepository } from '../etcd-storage-repository.js';

// ---------------------------------------------------------------------------
// Minimal in-memory etcd v3 JSON gateway mock. Mirrors the mock in the
// existing test file — all keys/values are base64-encoded on the wire.
// ---------------------------------------------------------------------------

const API = 'http://etcd.contract-test:2379';

interface Kv {
  key: string;
  value: string;
  createRevision: string;
  modRevision: string;
  version: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64encode = (s: string): string => {
  const bytes = enc.encode(s);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const b64decode = (s: string): string => {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return dec.decode(bytes);
};

interface RawCompare {
  target: 'CREATE' | 'MOD';
  result: 'EQUAL' | 'NOT_EQUAL';
  key: string;
  createRevision?: string;
  modRevision?: string;
}

const createMockEtcd = () => {
  const store = new Map<string, Kv>();
  let revisionCounter = 0;

  const nextRev = (): string => {
    revisionCounter += 1;
    return String(revisionCounter);
  };

  const doRange = (key: string, rangeEnd: string | undefined, limit?: number): Kv[] => {
    if (rangeEnd === undefined) {
      const kv = store.get(key);
      return kv ? [kv] : [];
    }
    const out: Kv[] = [];
    for (const [k, kv] of store) {
      if (k >= key && k < rangeEnd) out.push(kv);
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return limit !== undefined ? out.slice(0, limit) : out;
  };

  const doPut = (key: string, value: string): void => {
    const existing = store.get(key);
    const rev = nextRev();
    store.set(key, {
      key,
      value,
      createRevision: existing?.createRevision ?? rev,
      modRevision: rev,
      version: String(Number(existing?.version ?? '0') + 1),
    });
  };

  const doDeleteRange = (key: string, rangeEnd: string | undefined): number => {
    if (rangeEnd === undefined) {
      if (store.delete(key)) {
        nextRev();
        return 1;
      }
      return 0;
    }
    let deleted = 0;
    for (const [k] of [...store]) {
      if (k >= key && k < rangeEnd) {
        store.delete(k);
        deleted += 1;
      }
    }
    if (deleted > 0) nextRev();
    return deleted;
  };

  const evalCompare = (c: RawCompare): boolean => {
    const decoded = b64decode(c.key);
    const kv = store.get(decoded);
    const actual = c.target === 'CREATE'
      ? (kv?.createRevision ?? '0')
      : (kv?.modRevision ?? '0');
    const expected = c.target === 'CREATE' ? c.createRevision! : c.modRevision!;
    return c.result === 'EQUAL' ? actual === expected : actual !== expected;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'POST' || !url.startsWith(API)) {
      return new Response('not allowed', { status: 405 });
    }
    const path = new URL(url).pathname;
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;

    if (path === '/v3/kv/range') {
      const key = b64decode(body['key'] as string);
      const rangeEnd = body['rangeEnd'] ? b64decode(body['rangeEnd'] as string) : undefined;
      const limit = body['limit'] ? Number(body['limit']) : undefined;
      const kvs = doRange(key, rangeEnd, limit);
      return new Response(
        JSON.stringify({
          kvs: kvs.map(kv => ({
            key: b64encode(kv.key),
            value: b64encode(kv.value),
            create_revision: kv.createRevision,
            mod_revision: kv.modRevision,
            version: kv.version,
          })),
          count: String(kvs.length),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (path === '/v3/kv/put') {
      doPut(b64decode(body['key'] as string), b64decode(body['value'] as string));
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (path === '/v3/kv/deleterange') {
      const key = b64decode(body['key'] as string);
      const rangeEnd = body['rangeEnd'] ? b64decode(body['rangeEnd'] as string) : undefined;
      const deleted = doDeleteRange(key, rangeEnd);
      return new Response(JSON.stringify({ deleted: String(deleted) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (path === '/v3/kv/txn') {
      const compares = (body['compare'] as RawCompare[] | undefined) ?? [];
      const succeeded = compares.every(evalCompare);
      const branch = (succeeded ? body['success'] : body['failure']) as Array<Record<string, unknown>> | undefined;
      const responses: Array<Record<string, unknown>> = [];
      for (const op of branch ?? []) {
        if ('requestPut' in op) {
          const reqPut = op['requestPut'] as { key: string, value: string };
          doPut(b64decode(reqPut.key), b64decode(reqPut.value));
          responses.push({ responsePut: {} });
        } else if ('requestDeleteRange' in op) {
          const reqDel = op['requestDeleteRange'] as { key: string, rangeEnd?: string };
          const deleted = doDeleteRange(
            b64decode(reqDel.key),
            reqDel.rangeEnd ? b64decode(reqDel.rangeEnd) : undefined,
          );
          responses.push({ responseDeleteRange: { deleted: String(deleted) } });
        } else if ('requestRange' in op) {
          responses.push({ responseRange: { kvs: [] } });
        }
      }
      return new Response(JSON.stringify({ succeeded, responses }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  };

  return { fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as Record<string, unknown>,
  },
});

export const etcdContractCase: StorageContractCase = {
  name: 'EtcdStorageRepository',
  async makeRepo() {
    const { fetchImpl } = createMockEtcd();
    const ds = new EtcdDataSource({ url: API, fetch: fetchImpl });
    return new EtcdStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry() as never,
      defaultFileExtension: 'json',
    });
  },
};
