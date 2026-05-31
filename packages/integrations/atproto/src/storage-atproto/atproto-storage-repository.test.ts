import { createHash } from 'node:crypto';

import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atprotoContractCase } from './testing/index.js';

import { type ApplyWritesAction, AtprotoDataSource, pathToRkey, rkeyToPath } from './atproto-datasource.js';
import { AtprotoStorageRepository } from './atproto-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory AT Protocol PDS mock.
//
// Six XRPC endpoints carry the test surface:
//
//   GET  /xrpc/com.atproto.repo.getRecord     ?repo=&collection=&rkey=
//   GET  /xrpc/com.atproto.repo.listRecords   ?repo=&collection=&rkeyStart=&rkeyEnd=&limit=
//   POST /xrpc/com.atproto.repo.createRecord  { repo, collection, rkey, record }
//   POST /xrpc/com.atproto.repo.putRecord     { repo, collection, rkey, record, swapRecord? }
//   POST /xrpc/com.atproto.repo.deleteRecord  { repo, collection, rkey }
//   POST /xrpc/com.atproto.repo.applyWrites   { repo, writes: [...] }
//
// The mock synthesises a CID for every record using SHA-256 over the
// canonical JSON encoding (the real PDS uses CBOR + multihash + multicodec;
// for test purposes JSON is faithful enough — what we care about is that
// the CID changes on every write).
// ---------------------------------------------------------------------------

const PDS = 'https://pds.test';
const REPO = 'did:plc:test123';
const TOKEN = 'atproto_test_jwt';

interface StoredRecord {
  uri: string;
  cid: string;
  collection: string;
  rkey: string;
  value: Record<string, unknown>;
}

let store: Map<string, StoredRecord>; // keyed by `${collection}:${rkey}`
let applyWritesCount: number;
let getRecordCount: number;

const makeKey = (collection: string, rkey: string): string => `${collection}:${rkey}`;

// Faithful enough CID synthesis: SHA-256 over canonicalised JSON.
const synthCid = (value: Record<string, unknown>): string => {
  // Canonicalise by sorting keys.
  const sorted = JSON.stringify(value, Object.keys(value).sort());
  const hash = createHash('sha256').update(sorted).digest('hex');
  // Mimic the multibase prefix the real PDS uses.
  return `bafyrei${hash.slice(0, 52)}`;
};

const uriFor = (collection: string, rkey: string): string => `at://${REPO}/${collection}/${rkey}`;

// ---- XRPC dispatchers ----------------------------------------------------

interface MockResponse {
  status: number;
  body?: unknown;
}

const handleXrpc = (
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
): MockResponse => {
  // ---- GET getRecord -----------------------------------------------------
  if (method === 'GET' && pathname === '/xrpc/com.atproto.repo.getRecord') {
    getRecordCount += 1;
    const collection = query.get('collection')!;
    const rkey = query.get('rkey')!;
    const stored = store.get(makeKey(collection, rkey));
    if (!stored) return { status: 404, body: { error: 'RecordNotFound', message: `${collection}/${rkey}` } };
    return { status: 200, body: { uri: stored.uri, cid: stored.cid, value: stored.value } };
  }

  // ---- GET listRecords --------------------------------------------------
  if (method === 'GET' && pathname === '/xrpc/com.atproto.repo.listRecords') {
    const collection = query.get('collection')!;
    const rkeyStart = query.get('rkeyStart') ?? undefined;
    const rkeyEnd = query.get('rkeyEnd') ?? undefined;
    const limit = Number(query.get('limit') ?? '50');
    const all = [...store.values()]
      .filter(r => r.collection === collection)
      .filter(r => rkeyStart === undefined || r.rkey >= rkeyStart)
      .filter(r => rkeyEnd === undefined || r.rkey < rkeyEnd)
      .sort((a, b) => a.rkey.localeCompare(b.rkey))
      .slice(0, limit);
    return {
      status: 200,
      body: {
        records: all.map(r => ({ uri: r.uri, cid: r.cid, value: r.value })),
      },
    };
  }

  // ---- POST createRecord -------------------------------------------------
  if (method === 'POST' && pathname === '/xrpc/com.atproto.repo.createRecord') {
    const { collection, rkey, record } = body as {
      collection: string,
      rkey: string,
      record: Record<string, unknown>,
    };
    const key = makeKey(collection, rkey);
    if (store.has(key)) {
      return { status: 400, body: { error: 'RecordAlreadyExists', message: `${collection}/${rkey}` } };
    }
    const cid = synthCid(record);
    store.set(key, { uri: uriFor(collection, rkey), cid, collection, rkey, value: record });
    return { status: 200, body: { uri: uriFor(collection, rkey), cid } };
  }

  // ---- POST putRecord ----------------------------------------------------
  if (method === 'POST' && pathname === '/xrpc/com.atproto.repo.putRecord') {
    const { collection, rkey, record, swapRecord } = body as {
      collection: string,
      rkey: string,
      record: Record<string, unknown>,
      swapRecord?: string,
    };
    const key = makeKey(collection, rkey);
    const existing = store.get(key);
    if (swapRecord !== undefined && existing && existing.cid !== swapRecord) {
      return { status: 400, body: { error: 'InvalidSwap', message: 'Record swapRecord CID mismatch' } };
    }
    const cid = synthCid(record);
    store.set(key, { uri: uriFor(collection, rkey), cid, collection, rkey, value: record });
    return { status: 200, body: { uri: uriFor(collection, rkey), cid } };
  }

  // ---- POST deleteRecord ------------------------------------------------
  if (method === 'POST' && pathname === '/xrpc/com.atproto.repo.deleteRecord') {
    const { collection, rkey } = body as { collection: string, rkey: string };
    store.delete(makeKey(collection, rkey));
    return { status: 200, body: {} };
  }

  // ---- POST applyWrites -------------------------------------------------
  if (method === 'POST' && pathname === '/xrpc/com.atproto.repo.applyWrites') {
    applyWritesCount += 1;
    const { writes } = body as { writes: ApplyWritesAction[] };
    const results: Array<Record<string, unknown>> = [];
    // Atomic — collect intended mutations first, then apply.
    const mutations: Array<() => void> = [];
    for (const w of writes) {
      if (w.$type === 'com.atproto.repo.applyWrites#create') {
        if (store.has(makeKey(w.collection, w.rkey))) {
          return { status: 400, body: { error: 'RecordAlreadyExists', message: `${w.collection}/${w.rkey}` } };
        }
        const cid = synthCid(w.value);
        mutations.push(() => {
          store.set(makeKey(w.collection, w.rkey), {
            uri: uriFor(w.collection, w.rkey),
            cid,
            collection: w.collection,
            rkey: w.rkey,
            value: w.value,
          });
        });
        results.push({
          $type: 'com.atproto.repo.applyWrites#createResult',
          uri: uriFor(w.collection, w.rkey),
          cid,
          validationStatus: 'valid',
        });
      } else if (w.$type === 'com.atproto.repo.applyWrites#update') {
        const cid = synthCid(w.value);
        mutations.push(() => {
          store.set(makeKey(w.collection, w.rkey), {
            uri: uriFor(w.collection, w.rkey),
            cid,
            collection: w.collection,
            rkey: w.rkey,
            value: w.value,
          });
        });
        results.push({
          $type: 'com.atproto.repo.applyWrites#updateResult',
          uri: uriFor(w.collection, w.rkey),
          cid,
          validationStatus: 'valid',
        });
      } else if (w.$type === 'com.atproto.repo.applyWrites#delete') {
        mutations.push(() => {
          store.delete(makeKey(w.collection, w.rkey));
        });
        results.push({
          $type: 'com.atproto.repo.applyWrites#deleteResult',
        });
      }
    }
    // Apply atomically — all-or-nothing.
    for (const m of mutations) m();
    return { status: 200, body: { results } };
  }

  return { status: 404, body: { error: 'XRPCNotFound', message: `mock: no route for ${method} ${pathname}` } };
};

// ---- Mock fetch ----------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const urlStr = typeof input === 'string' ? input : (input as URL).toString();
  if (!urlStr.startsWith(PDS)) return new Response('not found', { status: 404 });

  const url = new URL(urlStr);
  const method = (init?.method ?? 'GET').toUpperCase();
  const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
  if (auth !== `Bearer ${TOKEN}`) return new Response('Unauthorized', { status: 401 });

  let body: Record<string, unknown> | null = null;
  if (init?.body) {
    body = JSON.parse(init.body as string) as Record<string, unknown>;
  }
  const result = handleXrpc(method, url.pathname, url.searchParams, body);
  return new Response(
    result.body !== undefined ? JSON.stringify(result.body) : null,
    { status: result.status, headers: { 'content-type': 'application/json' } },
  );
};

// ---------------------------------------------------------------------------
// Serializer registry.
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) => String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (fetchImpl: typeof fetch = mockFetch): AtprotoStorageRepository => {
  const ds = new AtprotoDataSource({
    auth: { accessJwt: TOKEN },
    repo: REPO,
    pdsUrl: PDS,
    fetch: fetchImpl,
  });
  return new AtprotoStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  store = new Map();
  applyWritesCount = 0;
  getRecordCount = 0;
});

afterEach(() => {
  store.clear();
});

describe('pathToRkey / rkeyToPath', () => {
  it('round-trips slashes through `:` and back', () => {
    expect(pathToRkey('notes/hello')).toBe('notes:hello');
    expect(pathToRkey('a/b/c')).toBe('a:b:c');
    expect(pathToRkey('/with-leading')).toBe('with-leading');
    expect(rkeyToPath('notes:hello')).toBe('notes/hello');
    expect(rkeyToPath('a:b:c')).toBe('a/b/c');
  });
});

describe('AtprotoStorageRepository', () => {
  it('createObject writes a record with $type, path, parent, name, extension', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // CID surfaces as revisionId — and it's a content hash (starts with bafyrei).
    expect(created.metadata?.revisionId).toMatch(/^bafyrei/);

    // Verify the on-wire record value shape.
    const stored = store.get('com.laikacms.file:notes:hello.md');
    expect(stored?.value).toMatchObject({
      $type: 'com.laikacms.file',
      path: 'notes/hello',
      parent: 'notes',
      name: 'hello',
      extension: 'md',
      content: 'hi',
    });

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('CID changes on every update (content-addressable revisionId)', async () => {
    const repo = makeRepo();
    const v1 = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    const v2 = await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    expect(v1.metadata?.revisionId).not.toBe(v2.metadata?.revisionId);
    // Both still match the CID shape.
    expect(v1.metadata?.revisionId).toMatch(/^bafyrei/);
    expect(v2.metadata?.revisionId).toMatch(/^bafyrei/);
  });

  it('createObject rejects duplicates via 400 RecordAlreadyExists', async () => {
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

  it('updateObject passes the prior CID as swapRecord (CAS)', async () => {
    // Sniff the putRecord body to verify swapRecord is set.
    let lastPutBody: { swapRecord?: string } | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/xrpc/com.atproto.repo.putRecord') && (init?.method ?? 'GET') === 'POST') {
        lastPutBody = JSON.parse(init!.body as string);
      }
      return mockFetch(input, init);
    };
    const repo = makeRepo(sniff);
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    expect(lastPutBody!.swapRecord).toBe(created.metadata?.revisionId);
  });

  it('removeAtoms ships as ONE applyWrites call with N #delete actions', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    applyWritesCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // *The* distinctive behavior — exactly one applyWrites call.
    expect(applyWritesCount).toBe(1);
    // And every record gone.
    expect([...store.values()].filter(r => r.collection === 'com.laikacms.file')).toHaveLength(0);
  });

  it('removeAtoms emits #delete actions with the correct $type discriminator', async () => {
    // Capture the applyWrites body.
    let lastWritesBody: { writes?: ApplyWritesAction[] } | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/xrpc/com.atproto.repo.applyWrites') && (init?.method ?? 'GET') === 'POST') {
        lastWritesBody = JSON.parse(init!.body as string);
      }
      return mockFetch(input, init);
    };
    const repo = makeRepo(sniff);
    for (const k of ['a', 'b']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes/a', 'notes/b']));
    expect(lastWritesBody!.writes).toHaveLength(2);
    expect(lastWritesBody!.writes!.every(w => w.$type === 'com.atproto.repo.applyWrites#delete')).toBe(true);
    // Each carries (collection, rkey) but no `value` field — delete doesn't need one.
    for (const w of lastWritesBody!.writes!) {
      expect(w.collection).toBe('com.laikacms.file');
      expect((w as { value?: unknown }).value).toBeUndefined();
    }
  });

  it('removeAtoms reports missing keys as skipped', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/nope']),
    );
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries uses rkey range scan and reconstructs hierarchy', async () => {
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

  it('listAtomSummaries dispatches an rkey range scan [<rkey>:, <rkey>;)', async () => {
    // Capture every listRecords URL.
    const rangeQueries: Array<{ rkeyStart?: string, rkeyEnd?: string }> = [];
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('/xrpc/com.atproto.repo.listRecords')) {
        const u = new URL(url);
        rangeQueries.push({
          rkeyStart: u.searchParams.get('rkeyStart') ?? undefined,
          rkeyEnd: u.searchParams.get('rkeyEnd') ?? undefined,
        });
      }
      return mockFetch(input, init);
    };
    const repo = makeRepo(sniff);
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    rangeQueries.length = 0;

    await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('notes', { pagination: PAGE }),
    );
    // The repository dispatches range scans on both collections.
    const fileScan = rangeQueries.find(q => q.rkeyStart === 'notes:');
    expect(fileScan).toBeDefined();
    expect(fileScan!.rkeyEnd).toBe('notes;');
  });

  it('createFolder creates a record in the folder collection', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    const stored = store.get('com.laikacms.folder:empty');
    expect(stored?.value).toMatchObject({
      $type: 'com.laikacms.folder',
      path: 'empty',
      name: 'empty',
    });

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

  it('getFolder fails for a missing path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found|empty/i);
  });

  it('record URIs use the at:// scheme with DID/collection/rkey segments', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    const stored = store.get('com.laikacms.file:notes:hello.md');
    expect(stored?.uri).toBe(`at://${REPO}/com.laikacms.file/notes:hello.md`);
  });
});

// Reference unused symbols to keep lints quiet.
void getRecordCount;

runStorageRepositoryContract(atprotoContractCase);
