import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CloudflareImagesAssetsRepository } from './cf-images-assets-repository.js';
import { type CloudflareImageResource } from './cf-images-datasource.js';

// ---------------------------------------------------------------------------
// In-memory Cloudflare Images mock. Cloudflare's API wraps every response
// in `{result, success, errors, messages}` — the mock honours that envelope.
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 'acct';
const ACCOUNT_HASH = 'hash-XXXXXX';
const API_URL = 'https://mock.cloudflare.test/client/v4';

interface StoredImage {
  id: string;
  filename?: string;
  uploaded: string;
  size: number;
  body: string;
  metadata: Record<string, string>;
}

const createMockCfImages = () => {
  const images = new Map<string, StoredImage>();

  const okEnvelope = (result: unknown) => ({
    success: true,
    errors: [],
    messages: [],
    result,
  });

  const errEnvelope = (message: string) => ({
    success: false,
    errors: [{ message }],
    messages: [],
    result: null,
  });

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const resourceFor = (img: StoredImage): CloudflareImageResource => ({
    id: img.id,
    filename: img.filename,
    uploaded: img.uploaded,
    requireSignedURLs: false,
    variants: [
      `https://imagedelivery.net/${ACCOUNT_HASH}/${img.id}/public`,
      `https://imagedelivery.net/${ACCOUNT_HASH}/${img.id}/thumbnail`,
    ],
    meta: img.metadata,
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const prefix = `/client/v4/accounts/${ACCOUNT_ID}/images/v1`;
    if (!url.pathname.startsWith(prefix)) return new Response('not found', { status: 404 });
    const tail = url.pathname.slice(prefix.length);

    // POST / — multipart upload
    if (tail === '' && method === 'POST') {
      const form = init?.body as FormData;
      const id = String(form.get('id') ?? `auto-${Date.now()}`);
      const fileBlob = form.get('file') as Blob | null;
      const body = fileBlob ? await fileBlob.text() : '';
      const filename = (form.get('file') as File | null)?.name;
      const metaStr = form.get('metadata');
      const image: StoredImage = {
        id,
        filename,
        uploaded: new Date().toISOString(),
        size: body.length,
        body,
        metadata: typeof metaStr === 'string' ? JSON.parse(metaStr) : {},
      };
      images.set(id, image);
      return json(okEnvelope(resourceFor(image)));
    }

    // GET / — list
    if (tail === '' && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const perPage = Number(url.searchParams.get('per_page') ?? '100');
      const start = (page - 1) * perPage;
      const all = [...images.values()];
      const slice = all.slice(start, start + perPage);
      return json(okEnvelope({ images: slice.map(resourceFor) }));
    }

    // GET / DELETE /{id}
    const idMatch = tail.match(/^\/(.+)$/);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      const image = images.get(id);
      if (method === 'GET') {
        if (!image) return json(errEnvelope('Resource not found'), { status: 404 });
        return json(okEnvelope(resourceFor(image)));
      }
      if (method === 'DELETE') {
        if (!image) return json(errEnvelope('Resource not found'), { status: 404 });
        images.delete(id);
        return json(okEnvelope({}));
      }
    }

    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { images, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockCfImages>;

beforeEach(() => {
  mock = createMockCfImages();
});
afterEach(() => {
  mock.images.clear();
});

const makeRepo = () =>
  new CloudflareImagesAssetsRepository({
    auth: { apiToken: 'cf-test' },
    accountId: ACCOUNT_ID,
    accountHash: ACCOUNT_HASH,
    apiUrl: API_URL,
    fetch: mock.fetch,
    variants: [
      { name: 'public', mimeType: 'image/jpeg' },
      { name: 'thumbnail', width: 150, height: 150, mimeType: 'image/jpeg' },
      { name: 'medium', width: 800, mimeType: 'image/jpeg' },
    ],
  });

const tinyPng = (): Uint8Array => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CloudflareImagesAssetsRepository CRUD', () => {
  it('creates, reads, and deletes an asset', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createAsset({
        key: 'photos/hero',
        content: tinyPng(),
        mimeType: 'image/png',
        filename: 'hero.png',
        customMetadata: { width: '1200', height: '630' },
      }),
    );
    expect(created.type).toBe('asset');
    expect(created.key).toBe('photos/hero');
    expect((created.content as Record<string, unknown>).cloudflareId).toBe('photos/hero');
    expect(mock.images.has('photos/hero')).toBe(true);

    const fetched = await LaikaTask.runPromise(repo.getAsset('photos/hero'));
    expect(fetched.key).toBe('photos/hero');

    await LaikaTask.runPromise(repo.deleteAsset('photos/hero'));
    expect(mock.images.has('photos/hero')).toBe(false);
  });

  it('rejects MIME types outside the allow-list', async () => {
    const repo = new CloudflareImagesAssetsRepository({
      auth: { apiToken: 'cf-test' },
      accountId: ACCOUNT_ID,
      accountHash: ACCOUNT_HASH,
      apiUrl: API_URL,
      fetch: mock.fetch,
      allowedMimeTypes: ['image/png', 'image/jpeg'],
    });
    await expect(
      LaikaTask.runPromise(
        repo.createAsset({ key: 'bad', content: tinyPng(), mimeType: 'application/pdf' }),
      ),
    ).rejects.toThrow(/Disallowed MIME type/);
  });

  it('deleteAssets is idempotent — missing keys count as removed (CF Images delete is idempotent on 404)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createAsset({ key: 'a', content: tinyPng(), mimeType: 'image/png' }));
    await LaikaTask.runPromise(repo.createAsset({ key: 'b', content: tinyPng(), mimeType: 'image/png' }));

    // Cloudflare Images' DELETE /{id} returns 404 for missing ids; the
    // data source treats that as success (idempotent semantics). So
    // `deleteAssets(['a', 'b', 'never-existed'])` reports 3 removed —
    // unlike Cloudinary (iter 10) which has a per-key bulk-delete
    // response shape that distinguishes deleted-vs-not-found.
    const collected = await LaikaStream.runPromiseCollect(repo.deleteAssets(['a', 'b', 'never-existed']));
    expect(collected.data.sort()).toEqual(['a', 'b', 'never-existed']);
    expect(collected.done.removed).toBe(3);
    expect(collected.done.skipped).toBe(0);
  });
});

describe('CloudflareImagesAssetsRepository URLs and variations', () => {
  it('builds the default `public` delivery URL via the imagedelivery.net pattern', async () => {
    const repo = makeRepo();
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'photo', content: tinyPng(), mimeType: 'image/png' }),
    );

    const collected = await LaikaStream.runPromiseCollect(repo.getUrls([asset]));
    expect(collected.data[0].url).toBe(`https://imagedelivery.net/${ACCOUNT_HASH}/photo/public`);
  });

  it('emits one URL per configured variant (account-level, not per-URL like Cloudinary)', async () => {
    const repo = makeRepo();
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'photo', content: tinyPng(), mimeType: 'image/png' }),
    );

    const collected = await LaikaStream.runPromiseCollect(repo.getVariations([asset]));
    expect(collected.data).toHaveLength(1);
    const variations = collected.data[0].variations;

    expect(Object.keys(variations).sort()).toEqual(['medium', 'public', 'thumbnail']);
    expect(variations.thumbnail.url).toBe(`https://imagedelivery.net/${ACCOUNT_HASH}/photo/thumbnail`);
    expect(variations.thumbnail.width).toBe(150);
    expect(variations.medium.url).toBe(`https://imagedelivery.net/${ACCOUNT_HASH}/photo/medium`);
  });

  it('honours `deliveryUrl` override (custom Worker-fronted domain)', async () => {
    const repo = new CloudflareImagesAssetsRepository({
      auth: { apiToken: 'cf-test' },
      accountId: ACCOUNT_ID,
      accountHash: ACCOUNT_HASH,
      apiUrl: API_URL,
      fetch: mock.fetch,
      deliveryUrl: ({ imageId, variant }) => `https://cdn.example.com/${variant}/${imageId}.webp`,
      variants: [{ name: 'public' }],
    });
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'photo', content: tinyPng(), mimeType: 'image/png' }),
    );
    const collected = await LaikaStream.runPromiseCollect(repo.getUrls([asset]));
    expect(collected.data[0].url).toBe('https://cdn.example.com/public/photo.webp');
  });
});

describe('CloudflareImagesAssetsRepository virtual folders', () => {
  it('synthesises folders from id prefixes', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createAsset({ key: 'photos/hero', content: tinyPng(), mimeType: 'image/png' }));
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'photos/sub/nested', content: tinyPng(), mimeType: 'image/png' }),
    );
    await LaikaTask.runPromise(repo.createAsset({ key: 'standalone', content: tinyPng(), mimeType: 'image/png' }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('photos', { pagination: { offset: 0, limit: 100 }, depth: 1 }),
    );
    const byKey = Object.fromEntries(collected.data.map(r => [r.key, r.type] as const));
    expect(byKey['photos/hero']).toBe('asset');
    expect(byKey['photos/sub']).toBe('folder');
    expect(byKey['photos/sub/nested']).toBeUndefined(); // direct children only
    expect(byKey['standalone']).toBeUndefined(); // outside the listed folder
  });

  it('reports a missing folder as NotFoundError on direct getFolder', async () => {
    await expect(
      LaikaTask.runPromise(makeRepo().getFolder('does/not/exist')),
    ).rejects.toThrow(NotFoundError);
  });
});
