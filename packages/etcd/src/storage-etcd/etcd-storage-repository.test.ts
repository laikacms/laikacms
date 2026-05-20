import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EtcdDataSource, prefixRangeEnd } from './etcd-datasource.js';
import { EtcdStorageRepository } from './etcd-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory etcd v3 JSON gateway mock.
//
// Four endpoints carry the test surface:
//
//   POST /v3/kv/range         body { key, rangeEnd?, limit? }
//   POST /v3/kv/put           body { key, value }
//   POST /v3/kv/deleterange   body { key, rangeEnd? }
//   POST /v3/kv/txn           body { compare?, success?, failure? }
//
// All keys / values are base64-encoded on the wire — the mock decodes
// them at the edge.
// ---------------------------------------------------------------------------

const API = 'http://etcd.test:2379';

interface Kv {
  key: string;
  value: string;
  createRevision: string;
  modRevision: string;
  version: string;
}

let store: Map<string, Kv>;
let revisionCounter: number;
let rangeCount: number;
let putCount: number;
let deleteRangeCount: number;
let txnCount: number;

// ---- base64 helpers (mirror the data source's pair) ----------------------

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

// ---- KV ops ---------------------------------------------------------------

const nextRev = (): string => { revisionCounter += 1; return String(revisionCounter); };

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

// ---- Txn evaluator --------------------------------------------------------

interface RawCompare {
  target: 'CREATE' | 'MOD';
  result: 'EQUAL' | 'NOT_EQUAL';
  key: string;
  createRevision?: string;
  modRevision?: string;
}

const evalCompare = (c: RawCompare): boolean => {
  const decoded = b64decode(c.key);
  const kv = store.get(decoded);
  const actual = c.target === 'CREATE'
    ? (kv?.createRevision ?? '0')
    : (kv?.modRevision ?? '0');
  const expected = c.target === 'CREATE' ? c.createRevision! : c.modRevision!;
  return c.result === 'EQUAL' ? actual === expected : actual !== expected;
};

// ---- Mock fetch -----------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'POST' || !url.startsWith(API)) {
    return new Response('not allowed', { status: 405 });
  }
  const path = new URL(url).pathname;
  const body = JSON.parse(init?.body as string) as Record<string, unknown>;

  if (path === '/v3/kv/range') {
    rangeCount += 1;
    const key = b64decode(body['key'] as string);
    const rangeEnd = body['rangeEnd'] ? b64decode(body['rangeEnd'] as string) : undefined;
    const limit = body['limit'] ? Number(body['limit']) : undefined;
    const kvs = doRange(key, rangeEnd, limit);
    return new Response(JSON.stringify({
      kvs: kvs.map(kv => ({
        key: b64encode(kv.key),
        value: b64encode(kv.value),
        create_revision: kv.createRevision,
        mod_revision: kv.modRevision,
        version: kv.version,
      })),
      count: String(kvs.length),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (path === '/v3/kv/put') {
    putCount += 1;
    doPut(b64decode(body['key'] as string), b64decode(body['value'] as string));
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (path === '/v3/kv/deleterange') {
    deleteRangeCount += 1;
    const key = b64decode(body['key'] as string);
    const rangeEnd = body['rangeEnd'] ? b64decode(body['rangeEnd'] as string) : undefined;
    const deleted = doDeleteRange(key, rangeEnd);
    return new Response(JSON.stringify({ deleted: String(deleted) }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  if (path === '/v3/kv/txn') {
    txnCount += 1;
    const compares = (body['compare'] as RawCompare[] | undefined) ?? [];
    const succeeded = compares.every(evalCompare);
    const branch = (succeeded ? body['success'] : body['failure']) as Array<Record<string, unknown>> | undefined;
    const responses: Array<Record<string, unknown>> = [];
    for (const op of branch ?? []) {
      if ('requestPut' in op) {
        const reqPut = op['requestPut'] as { key: string; value: string };
        doPut(b64decode(reqPut.key), b64decode(reqPut.value));
        responses.push({ responsePut: {} });
      } else if ('requestDeleteRange' in op) {
        const reqDel = op['requestDeleteRange'] as { key: string; rangeEnd?: string };
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
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  return new Response('not found', { status: 404 });
};

// ---------------------------------------------------------------------------
// Minimal test serializer registry.
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) =>
      String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (basePath?: string, fetchImpl: typeof fetch = mockFetch): EtcdStorageRepository => {
  const ds = new EtcdDataSource({ url: API, fetch: fetchImpl });
  return new EtcdStorageRepository({
    dataSource: ds,
    basePath,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  store = new Map();
  revisionCounter = 0;
  rangeCount = 0;
  putCount = 0;
  deleteRangeCount = 0;
  txnCount = 0;
});

afterEach(() => {
  store.clear();
});

describe('prefixRangeEnd helper', () => {
  it('computes the next-prefix half of an etcd range', () => {
    // The canonical etcd prefix-scan idiom: increment last byte.
    expect(prefixRangeEnd('/notes/')).toBe('/notes0');
    expect(prefixRangeEnd('/abc')).toBe('/abd');
    expect(prefixRangeEnd('a')).toBe('b');
    // Empty prefix → null terminator means "scan everything".
    expect(prefixRangeEnd('')).toBe('\0');
  });
});

describe('EtcdStorageRepository', () => {
  it('createObject + getObject round-trip writes under /f/ with JSON value', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // mod_revision surfaces as revisionId.
    expect(created.metadata?.revisionId).toMatch(/^\d+$/);

    // The etcd key is the namespaced file path with extension.
    expect([...store.keys()]).toEqual(['/f/notes/hello.md']);
    const stored = JSON.parse(store.get('/f/notes/hello.md')!.value);
    expect(stored).toMatchObject({ type: 'file', extension: 'md', content: 'hi' });

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('createObject uses a CAS Txn — duplicate creates lose the compare', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('values cross the wire base64-encoded', async () => {
    // Sniff the put body to confirm both key and value are base64.
    let sniffedPutKey = '';
    let sniffedPutValue = '';
    const sniff: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === 'string' ? input : (input as URL).toString()).pathname;
      if (path === '/v3/kv/txn') {
        // CreateObject uses txn — peek at the success.requestPut.
        const body = JSON.parse(init?.body as string);
        if (body.success?.[0]?.requestPut) {
          sniffedPutKey = body.success[0].requestPut.key;
          sniffedPutValue = body.success[0].requestPut.value;
        }
      }
      return mockFetch(input, init);
    };
    const repo = makeRepo(undefined, sniff);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    // Key is base64('/f/notes/hello.md'); value is base64 of the JSON-encoded stored atom.
    expect(b64decode(sniffedPutKey)).toBe('/f/notes/hello.md');
    expect(b64decode(sniffedPutValue)).toContain('"type":"file"');
  });

  it('removeAtoms ships as ONE Txn with N requestDeleteRange ops', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }

    // Capture the Txn body.
    let lastTxnBody: { compare?: unknown[]; success?: unknown[] } | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === 'string' ? input : (input as URL).toString()).pathname;
      if (path === '/v3/kv/txn') {
        lastTxnBody = JSON.parse(init?.body as string);
      }
      return mockFetch(input, init);
    };
    const sniffRepo = makeRepo(undefined, sniff);

    txnCount = 0;
    deleteRangeCount = 0;

    const removed = await LaikaStream.runPromiseCollect(
      sniffRepo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });

    // Exactly one Txn — and its success array contains 3 delete ops.
    // (No /v3/kv/deleterange calls fired; everything went through Txn.)
    expect(txnCount).toBe(1);
    expect(deleteRangeCount).toBe(0);
    expect(lastTxnBody!.success).toHaveLength(3);
    expect(
      (lastTxnBody!.success as Array<Record<string, unknown>>).every(op => 'requestDeleteRange' in op),
    ).toBe(true);
    expect(store.size).toBe(0);
  });

  it('removeAtoms reports missing keys as skipped without aborting the Txn', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/nope']),
    );
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors.length).toBe(1);
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries reconstructs subfolder grouping from etcd range tails', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/sub/c', content: { body: 'c' } }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes/empty' }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('notes', { pagination: PAGE }),
    );
    const types = collected.data.reduce((acc, s) => {
      acc[s.key] = s.type;
      return acc;
    }, {} as Record<string, string>);
    expect(types).toEqual({
      'notes/a': 'object-summary',
      'notes/b': 'object-summary',
      'notes/sub': 'folder-summary',
      'notes/empty': 'folder-summary',
    });
  });

  it('listing uses the prefix-range idiom (range_end = increment last byte)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));

    // Capture range bodies.
    const rangeBodies: Array<{ key: string; rangeEnd?: string }> = [];
    const sniff: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === 'string' ? input : (input as URL).toString()).pathname;
      if (path === '/v3/kv/range') {
        const body = JSON.parse(init?.body as string);
        rangeBodies.push({
          key: b64decode(body.key),
          rangeEnd: body.rangeEnd ? b64decode(body.rangeEnd) : undefined,
        });
      }
      return mockFetch(input, init);
    };
    const sniffRepo = makeRepo(undefined, sniff);

    await LaikaStream.runPromiseCollect(
      sniffRepo.listAtomSummaries('notes', { pagination: PAGE }),
    );

    // listAtomSummaries fires two prefix scans (one /d/, one /f/) — both
    // must use `range_end = key + 1` (i.e. `/` → `0`).
    const fileScan = rangeBodies.find(b => b.key === '/f/notes/');
    expect(fileScan).toBeDefined();
    expect(fileScan!.rangeEnd).toBe('/f/notes0');
    const folderScan = rangeBodies.find(b => b.key === '/d/notes/');
    expect(folderScan).toBeDefined();
    expect(folderScan!.rangeEnd).toBe('/d/notes0');
  });

  it('createFolder creates an explicit /d/ entry; getFolder finds it', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    expect([...store.keys()]).toContain('/d/empty');
    const folder = await LaikaTask.runPromise(repo.getFolder('empty'));
    expect(folder.type).toBe('folder');
  });

  it('getFolder recognises a folder via descendants (implicit)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'x' } }),
    );
    const folder = await LaikaTask.runPromise(repo.getFolder('notes'));
    expect(folder.type).toBe('folder');
  });

  it('basePath scopes every etcd key', async () => {
    const repo = makeRepo('site-a');
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'x' } }),
    );
    expect([...store.keys()]).toEqual(['/site-a/f/notes/x.md']);
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(fetched.key).toBe('notes/x');
  });
});
