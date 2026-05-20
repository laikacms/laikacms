import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type PinataPinRow } from './pinata-datasource.js';
import { PinataStorageRepository } from './pinata-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Pinata mock. Pins are addressed by a synthesized CID; the
// content lives in a parallel Map keyed by CID. The mock honours Pinata's
// search-by-metadata semantics for the subset the repository exercises:
//
//   metadata[name]=<exact>                       — name equality
//   metadata[keyvalues]={"parent": {"value":"x","op":"eq"}}  — keyvalues filter
// ---------------------------------------------------------------------------

interface Pin {
  id: string;
  cid: string;
  content: string;
  size: number;
  date_pinned: string;
  metadata: PinataPinRow['metadata'];
}

const API_URL = 'https://mock.pinata.test';
const GATEWAY_URL = 'https://mock-gw.pinata.test/ipfs';

const createMockPinata = () => {
  const pins = new Map<string, Pin>();
  let cidCounter = 0;
  const newCid = (): string => `Qm${(++cidCounter).toString(16).padStart(44, 'a')}`;

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    // Pinning API ------------------------------------------------------------
    if (path === '/pinning/pinFileToIPFS' && method === 'POST') {
      const form = init?.body as FormData;
      const fileBlob = form.get('file') as Blob | null;
      const metaRaw = form.get('pinataMetadata') as string | null;
      const content = fileBlob ? await fileBlob.text() : '';
      const meta = metaRaw
        ? (JSON.parse(metaRaw) as { name: string; keyvalues: PinataPinRow['metadata']['keyvalues'] })
        : { name: '', keyvalues: {} as PinataPinRow['metadata']['keyvalues'] };
      const cid = newCid();
      const pin: Pin = {
        id: `id-${cid}`,
        cid,
        content,
        size: content.length,
        date_pinned: new Date().toISOString(),
        metadata: meta,
      };
      pins.set(cid, pin);
      return json({ IpfsHash: cid, PinSize: pin.size, Timestamp: pin.date_pinned });
    }

    const unpinMatch = path.match(/^\/pinning\/unpin\/(.+)$/);
    if (unpinMatch && method === 'DELETE') {
      const cid = decodeURIComponent(unpinMatch[1]);
      if (!pins.has(cid)) return new Response('Not pinned', { status: 404 });
      pins.delete(cid);
      return new Response('OK', { status: 200 });
    }

    if (path === '/data/pinList' && method === 'GET') {
      const nameFilter = url.searchParams.get('metadata[name]');
      const keyvaluesFilter = url.searchParams.get('metadata[keyvalues]');
      let kvParent: string | undefined;
      if (keyvaluesFilter) {
        const parsed = JSON.parse(keyvaluesFilter) as Record<string, { value: string; op: string }>;
        kvParent = parsed.parent?.value;
      }
      const rows = [...pins.values()].filter(p => {
        if (nameFilter !== null && p.metadata.name !== nameFilter) return false;
        if (kvParent !== undefined && p.metadata.keyvalues.parent !== kvParent) return false;
        return true;
      });
      return json({
        rows: rows.map(p => ({
          id: p.id,
          ipfs_pin_hash: p.cid,
          size: p.size,
          date_pinned: p.date_pinned,
          metadata: p.metadata,
        })),
        count: rows.length,
      });
    }

    // Gateway ---------------------------------------------------------------
    if (url.toString().startsWith(GATEWAY_URL)) {
      const cid = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      const pin = pins.get(cid);
      if (!pin) return new Response('Not pinned', { status: 404 });
      return new Response(pin.content, { status: 200 });
    }

    return new Response(`{"unhandled":"${method} ${url.toString()}"}`, { status: 501 });
  };

  return { pins, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockPinata>;

beforeEach(() => { mock = createMockPinata(); });
afterEach(() => { mock.pins.clear(); });

const makeRepo = () =>
  new PinataStorageRepository({
    auth: { token: 'pinata-jwt' },
    apiUrl: API_URL,
    gatewayUrl: GATEWAY_URL,
    fetch: mock.fetch,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PinataStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toMatch(/^Qm/); // CID
    expect(mock.pins.size).toBe(1);

    const initialCid = created.metadata!.revisionId;

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    // **Critical for IPFS** — updating produces a NEW CID, not the same one.
    expect(updated.metadata?.revisionId).not.toBe(initialCid);
    // And the old CID is unpinned (the copy-on-write cleanup half).
    expect(mock.pins.has(initialCid!)).toBe(false);
    expect(mock.pins.size).toBe(1);

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(mock.pins.size).toBe(0);
  });

  it('auto-pins ancestor folder markers for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    const folderPins = [...mock.pins.values()].filter(p => p.metadata.keyvalues.type === 'folder');
    expect(folderPins.map(p => p.metadata.name).sort()).toEqual(['a', 'a/b']);

    const filePins = [...mock.pins.values()].filter(p => p.metadata.keyvalues.type === 'file');
    expect(filePins.map(p => p.metadata.name)).toEqual(['a/b/c.md']);
  });

  it('rejects a duplicate createObject for the same key', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'one' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'hello', content: { body: 'two' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });
});

describe('PinataStorageRepository listing', () => {
  it('classifies files as object-summary and folders as folder-summary', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'top', content: { body: 'x' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('sorts numeric filenames naturally', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '1', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '10', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '2', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10']);
  });

  it('reports a missing folder as a recoverable NotFoundError', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('does/not/exist', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('PinataStorageRepository copy-on-write window', () => {
  it('returns the newest CID when the search index shows both old and new (simulating eventual consistency)', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'v1' } }),
    );

    // Manually simulate the post-update window by adding a second pin with
    // the same `metadata.name` and a later `date_pinned`. The mock's unpin
    // doesn't fire here — we're modeling what readers see between (1) and (2).
    const newCid = 'QmNEW0000000000000000000000000000000000000000';
    mock.pins.set(newCid, {
      id: `id-${newCid}`,
      cid: newCid,
      content: 'v2',
      size: 2,
      date_pinned: new Date(Date.now() + 5_000).toISOString(),
      metadata: {
        name: 'hello.md',
        keyvalues: { type: 'file', parent: '', extension: 'md', path: 'hello' },
      },
    });

    const fetched = await LaikaTask.runPromise(repo.getObject('hello'));
    expect(fetched.content).toEqual({ body: 'v2' });
    expect(fetched.metadata?.revisionId).toBe(newCid);
    expect(fetched.metadata?.revisionId).not.toBe(created.metadata?.revisionId);
  });
});

describe('PinataStorageRepository folder semantics', () => {
  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect([...mock.pins.values()].some(p =>
      p.metadata.keyvalues.type === 'folder' && p.metadata.name === 'notes',
    )).toBe(true);
  });

  it('refuses to delete the storage root', async () => {
    const attempt = await LaikaStream.runPromiseCollect(makeRepo().removeAtoms(['']));
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
  });
});
