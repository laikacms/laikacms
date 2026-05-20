import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CloudinaryAssetsRepository, DEFAULT_VARIATIONS } from './cloudinary-assets-repository.js';
import { signParams } from './cloudinary-datasource.js';

// ---------------------------------------------------------------------------
// In-memory Cloudinary mock — verifies signatures and folder semantics for
// the subset of the API the repository touches: signed upload, admin
// resource get/list/delete, folder CRUD.
// ---------------------------------------------------------------------------

interface StoredResource {
  public_id: string;
  format: string;
  resource_type: 'image';
  type: 'upload';
  version: number;
  bytes: number;
  width: number;
  height: number;
  created_at: string;
  etag: string;
}

const CLOUD = 'test-cloud';
const API_KEY = '123456';
const API_SECRET = 'super-secret';
const API_URL = 'https://mock.cloudinary.test/v1_1';
const DELIVERY_URL = 'https://mock-res.cloudinary.test';

const createMockCloudinary = () => {
  const resources = new Map<string, StoredResource>();
  const folders = new Set<string>(['']);                       // root always exists
  let versionCounter = 1000;

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const directSubfolders = (parent: string): Array<{ name: string; path: string }> => {
    const out: Array<{ name: string; path: string }> = [];
    for (const p of folders) {
      if (p === '' || p === parent) continue;
      const trimmedParent = parent === '' ? '' : `${parent}/`;
      if (!p.startsWith(trimmedParent)) continue;
      const rest = p.slice(trimmedParent.length);
      if (rest === '' || rest.includes('/')) continue;
      out.push({ name: rest, path: p });
    }
    return out;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const cloudPrefix = `/v1_1/${CLOUD}`;
    if (!path.startsWith(cloudPrefix)) return new Response('{"error":"bad cloud"}', { status: 400 });
    const rest = path.slice(cloudPrefix.length);

    // ---- Signed upload --------------------------------------------------
    if (rest === '/image/upload' && method === 'POST') {
      const form = new URLSearchParams((init?.body as string) ?? '');
      // Reconstruct the signable subset and verify the signature client-side.
      const signable: Record<string, string> = {};
      for (const [k, v] of form) {
        if (k === 'file' || k === 'api_key' || k === 'signature') continue;
        signable[k] = v;
      }
      const expected = await signParams(signable, API_SECRET);
      if (expected !== form.get('signature')) {
        return json({ error: { message: 'invalid signature' } }, { status: 401 });
      }
      const publicId = form.get('public_id')!;
      const overwrite = form.get('overwrite') !== 'false';
      if (resources.has(publicId) && !overwrite) {
        return json({ error: { message: 'Resource already exists' } }, { status: 400 });
      }
      const body = form.get('file') ?? '';
      const dataPayload = body.startsWith('data:')
        ? body.slice(body.indexOf(',') + 1)
        : body;
      versionCounter += 1;
      const resource: StoredResource = {
        public_id: publicId,
        format: 'png',
        resource_type: 'image',
        type: 'upload',
        version: versionCounter,
        bytes: dataPayload.length,
        width: 100,
        height: 100,
        created_at: new Date().toISOString(),
        etag: `etag-${versionCounter}`,
      };
      resources.set(publicId, resource);
      // Cloudinary auto-creates ancestor folders when an upload's public_id
      // contains `/`. Mirror that here so listings include the implicit folders.
      const segments = publicId.split('/').slice(0, -1);
      for (let i = 1; i <= segments.length; i++) {
        folders.add(segments.slice(0, i).join('/'));
      }
      return json(resource);
    }

    // ---- Admin: single resource ---------------------------------------
    const singleMatch = rest.match(/^\/resources\/image\/upload\/(.+)$/);
    if (singleMatch && method === 'GET') {
      const id = decodeURIComponent(singleMatch[1]);
      const resource = resources.get(id);
      if (!resource) return json({ error: { message: 'Not found' } }, { status: 404 });
      return json(resource);
    }

    // ---- Admin: bulk delete -------------------------------------------
    if (rest === '/resources/image/upload' && method === 'DELETE') {
      const result: Record<string, string> = {};
      for (const id of url.searchParams.getAll('public_ids[]')) {
        if (resources.has(id)) {
          resources.delete(id);
          result[id] = 'deleted';
        } else {
          result[id] = 'not_found';
        }
      }
      return json({ deleted: result });
    }

    // ---- Admin: list resources ----------------------------------------
    if (rest === '/resources/image' && method === 'GET') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const all = [...resources.values()];
      const matched = prefix === ''
        ? all
        : all.filter(r => r.public_id === prefix || r.public_id.startsWith(`${prefix}/`));
      return json({ resources: matched });
    }

    // ---- Admin: folders -----------------------------------------------
    if (rest === '/folders' && method === 'GET') {
      return json({ folders: directSubfolders('') });
    }
    const folderMatch = rest.match(/^\/folders\/(.+)$/);
    if (folderMatch && method === 'GET') {
      const path = decodeURIComponent(folderMatch[1]);
      if (!folders.has(path)) return json({ error: { message: 'Not found' } }, { status: 404 });
      return json({ folders: directSubfolders(path) });
    }
    if (folderMatch && method === 'POST') {
      const path = decodeURIComponent(folderMatch[1]);
      // Auto-create ancestor folders for parity with Cloudinary's behaviour.
      const segments = path.split('/');
      for (let i = 1; i <= segments.length; i++) {
        folders.add(segments.slice(0, i).join('/'));
      }
      return json({ success: true });
    }
    if (folderMatch && method === 'DELETE') {
      const path = decodeURIComponent(folderMatch[1]);
      const hasChildren = [...folders].some(p => p !== path && p.startsWith(`${path}/`))
        || [...resources.keys()].some(p => p.startsWith(`${path}/`));
      if (hasChildren) return json({ error: { message: 'Folder not empty' } }, { status: 409 });
      folders.delete(path);
      return json({ success: true });
    }

    return new Response(`{"unhandled":"${method} ${path}"}`, { status: 501 });
  };

  return { resources, folders, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockCloudinary>;

beforeEach(() => { mock = createMockCloudinary(); });
afterEach(() => { mock.resources.clear(); mock.folders.clear(); mock.folders.add(''); });

const makeRepo = () =>
  new CloudinaryAssetsRepository({
    auth: { cloudName: CLOUD, apiKey: API_KEY, apiSecret: API_SECRET },
    apiUrl: API_URL,
    deliveryUrl: DELIVERY_URL,
    fetch: mock.fetch,
  });

const samplePng = (): Uint8Array => {
  // Tiny PNG header so the payload has a recognisable shape, but the mock
  // doesn't care about the content beyond its length.
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('signParams', () => {
  it('produces the SHA-1 hex digest of `sorted-kv + secret` — pinned against `shasum`', async () => {
    // Verified externally: shasum -a 1 over the exact concatenation Cloudinary's
    // signing formula produces — `public_id=sample&timestamp=1234567890abcd`.
    const expected = 'bd4cfd249b578dcb16fe1b961225159591d7aa0e';
    const actual = await signParams({ public_id: 'sample', timestamp: 1234567890 }, 'abcd');
    expect(actual).toBe(expected);
  });

  it('sorts keys deterministically — order of input does not affect the signature', async () => {
    const a = await signParams({ b: 'x', a: 'y' }, 'k');
    const b = await signParams({ a: 'y', b: 'x' }, 'k');
    expect(a).toBe(b);
  });
});

describe('CloudinaryAssetsRepository asset operations', () => {
  it('createAsset signs the upload and round-trips public_id + format', async () => {
    const asset = await LaikaTask.runPromise(
      makeRepo().createAsset({ key: 'photos/hero', content: samplePng(), mimeType: 'image/png' }),
    );

    expect(asset.type).toBe('asset');
    expect(asset.key).toBe('photos/hero');
    expect(asset.content).toMatchObject({
      publicId: 'photos/hero',
      format: 'png',
      resourceType: 'image',
    });
    expect(mock.resources.has('photos/hero')).toBe(true);
  });

  it('getAsset returns the stored resource; missing keys raise NotFoundError', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'photo', content: samplePng(), mimeType: 'image/png' }),
    );

    const fetched = await LaikaTask.runPromise(repo.getAsset('photo'));
    expect(fetched.key).toBe('photo');

    await expect(LaikaTask.runPromise(repo.getAsset('missing'))).rejects.toThrow(NotFoundError);
  });

  it('deleteAssets emits per-key results and surfaces missing keys as recoverable warnings', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'a', content: samplePng(), mimeType: 'image/png' }),
    );
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'b', content: samplePng(), mimeType: 'image/png' }),
    );

    const collected = await LaikaStream.runPromiseCollect(
      repo.deleteAssets(['a', 'b', 'never-existed']),
    );

    expect(collected.data.sort()).toEqual(['a', 'b']);
    expect(collected.done.removed).toBe(2);
    expect(collected.done.skipped).toBe(1);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('CloudinaryAssetsRepository URL / variation generation', () => {
  it('getUrls emits the deterministic delivery URL — no API call needed', async () => {
    const repo = makeRepo();
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'photos/hero', content: samplePng(), mimeType: 'image/png' }),
    );

    const collected = await LaikaStream.runPromiseCollect(repo.getUrls([asset]));
    expect(collected.data).toHaveLength(1);
    expect(collected.data[0].url).toMatch(
      new RegExp(`^${DELIVERY_URL}/${CLOUD}/image/upload/v\\d+/photos/hero\\.png$`),
    );
  });

  it('getVariations emits the default six transforms with the correct URL shape', async () => {
    const repo = makeRepo();
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'photo', content: samplePng(), mimeType: 'image/png' }),
    );

    const collected = await LaikaStream.runPromiseCollect(repo.getVariations([asset]));
    expect(collected.data).toHaveLength(1);
    const variations = collected.data[0].variations;

    expect(Object.keys(variations).sort()).toEqual(
      DEFAULT_VARIATIONS.map(v => v.name).sort(),
    );
    expect(variations.thumbnail.url).toMatch(
      new RegExp(`^${DELIVERY_URL}/${CLOUD}/image/upload/c_fill,w_150,h_150/v\\d+/photo\\.png$`),
    );
    expect(variations.thumbnail.width).toBe(150);
    expect(variations.webp.mimeType).toBe('image/webp');
  });

  it('honours a custom variation set when one is supplied', async () => {
    const repo = new CloudinaryAssetsRepository({
      auth: { cloudName: CLOUD, apiKey: API_KEY, apiSecret: API_SECRET },
      apiUrl: API_URL,
      deliveryUrl: DELIVERY_URL,
      fetch: mock.fetch,
      variations: [{ name: 'tiny', transform: 'w_50,h_50,c_fill', width: 50, height: 50 }],
    });
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'photo', content: samplePng(), mimeType: 'image/png' }),
    );
    const collected = await LaikaStream.runPromiseCollect(repo.getVariations([asset]));
    expect(Object.keys(collected.data[0].variations)).toEqual(['tiny']);
  });
});

describe('CloudinaryAssetsRepository folders + listing', () => {
  it('createFolder creates a real Cloudinary folder; listResources surfaces it', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'photos' }));

    expect(mock.folders.has('photos')).toBe(true);

    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('', { pagination: { offset: 0, limit: 100 }, depth: 1 }),
    );

    const byKey = Object.fromEntries(collected.data.map(r => [r.key, r.type] as const));
    expect(byKey).toEqual({ photos: 'folder' });
  });

  it('listResources returns direct children only — nested assets do not leak in', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'photos' }));
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'photos/hero', content: samplePng(), mimeType: 'image/png' }),
    );
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'photos/sub/nested', content: samplePng(), mimeType: 'image/png' }),
    );

    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('photos', { pagination: { offset: 0, limit: 100 }, depth: 1 }),
    );

    // The "sub" folder is auto-created by uploading "photos/sub/nested".
    const types = Object.fromEntries(collected.data.map(r => [r.key, r.type] as const));
    expect(types['photos/hero']).toBe('asset');
    expect(types['photos/sub']).toBe('folder');
    expect(types['photos/sub/nested']).toBeUndefined();         // nested asset is filtered out
  });

  it('listResources on a missing folder surfaces a recoverable NotFoundError', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listResources('does/not/exist', { pagination: { offset: 0, limit: 100 }, depth: 1 }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('CloudinaryAssetsRepository getMetadata', () => {
  it('returns ImageMetadata with width/height/mimeType for image assets', async () => {
    const repo = makeRepo();
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'photo', content: samplePng(), mimeType: 'image/png' }),
    );
    const collected = await LaikaStream.runPromiseCollect(repo.getMetadata([asset]));

    expect(collected.data).toHaveLength(1);
    const meta = collected.data[0].metadata;
    expect(meta.kind).toBe('image');
    if (meta.kind === 'image') {
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(100);
      expect(meta.mimeType).toBe('image/png');
    }
  });
});
