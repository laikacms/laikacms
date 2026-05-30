import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { S3AssetsRepository } from './s3-assets-repository.js';

// ---------------------------------------------------------------------------
// Wire aws-sdk-client-mock to an in-memory Map. Same shape as the storage-s3
// test fixture so the patterns stay consistent across the two contracts.
// ---------------------------------------------------------------------------

interface StoredObject {
  body: Uint8Array | string;
  contentType?: string;
  cacheControl?: string;
  metadata: Record<string, string>;
  lastModified: Date;
  etag: string;
}

const BUCKET = 'test-assets';

const setupMock = () => {
  const store = new Map<string, StoredObject>();
  let etagCounter = 0;
  const s3 = mockClient(S3Client);

  s3.on(HeadObjectCommand).callsFake(input => {
    const obj = store.get(input.Key);
    if (!obj) {
      const err = new Error('NotFound');
      (err as { name: string }).name = 'NotFound';
      (err as { $metadata: unknown }).$metadata = { httpStatusCode: 404 };
      throw err;
    }
    const bodyLength = typeof obj.body === 'string' ? obj.body.length : obj.body.byteLength;
    return {
      ContentLength: bodyLength,
      LastModified: obj.lastModified,
      ETag: obj.etag,
      ContentType: obj.contentType,
      CacheControl: obj.cacheControl,
      Metadata: obj.metadata,
    };
  });

  s3.on(PutObjectCommand).callsFake(input => {
    etagCounter += 1;
    store.set(input.Key, {
      body: (input.Body as Uint8Array | string) ?? new Uint8Array(),
      contentType: input.ContentType,
      cacheControl: input.CacheControl,
      metadata: (input.Metadata as Record<string, string> | undefined) ?? {},
      lastModified: new Date(),
      etag: `"etag-${etagCounter}"`,
    });
    return { ETag: `"etag-${etagCounter}"` };
  });

  s3.on(DeleteObjectCommand).callsFake(input => {
    store.delete(input.Key);
    return {};
  });

  s3.on(ListObjectsV2Command).callsFake(input => {
    const prefix = input.Prefix ?? '';
    const delimiter = input.Delimiter;
    const maxKeys = input.MaxKeys ?? 1000;

    const contents: Array<{ Key: string, Size: number, ETag: string, LastModified: Date }> = [];
    const commonPrefixSet = new Set<string>();

    for (const [key, obj] of store) {
      if (!key.startsWith(prefix)) continue;
      const remainder = key.slice(prefix.length);
      if (delimiter && remainder.includes(delimiter)) {
        const idx = remainder.indexOf(delimiter);
        commonPrefixSet.add(prefix + remainder.slice(0, idx + delimiter.length));
        continue;
      }
      const bodyLength = typeof obj.body === 'string' ? obj.body.length : obj.body.byteLength;
      contents.push({ Key: key, Size: bodyLength, ETag: obj.etag, LastModified: obj.lastModified });
    }

    return {
      Contents: contents.slice(0, maxKeys),
      CommonPrefixes: [...commonPrefixSet].map(p => ({ Prefix: p })),
      IsTruncated: false,
      KeyCount: contents.length + commonPrefixSet.size,
    };
  });

  return { s3, store };
};

let ctx: ReturnType<typeof setupMock>;

beforeEach(() => {
  ctx = setupMock();
});
afterEach(() => {
  ctx.s3.restore();
  ctx.store.clear();
});

const makeRepo = (basePath?: string) =>
  new S3AssetsRepository({
    client: new S3Client({ region: 'us-east-1' }),
    bucket: BUCKET,
    basePath,
    variations: [
      {
        name: 'thumbnail',
        url: ({ key, bucket }) => `https://cdn.example.com/100x100/${bucket}/${key}`,
        width: 100,
        height: 100,
      },
      { name: 'medium', url: ({ key, bucket }) => `https://cdn.example.com/800/${bucket}/${key}`, width: 800 },
    ],
  });

const tinyPng = (): Uint8Array => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S3AssetsRepository CRUD', () => {
  it('creates, reads, and deletes an asset', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createAsset({
        key: 'photos/hero',
        content: tinyPng(),
        mimeType: 'image/png',
        filename: 'hero.png',
        customMetadata: { width: '1200', height: '630' },
        cacheControl: 'public, max-age=31536000',
      }),
    );

    expect(created.type).toBe('asset');
    expect(created.key).toBe('photos/hero');
    expect((created.content as Record<string, unknown>).mimeType).toBe('image/png');
    expect((created.content as Record<string, unknown>).format).toBe('png');
    expect(ctx.store.has('photos/hero')).toBe(true);
    expect(ctx.store.get('photos/hero')?.contentType).toBe('image/png');

    const fetched = await LaikaTask.runPromise(repo.getAsset('photos/hero'));
    expect(fetched.key).toBe('photos/hero');

    await LaikaTask.runPromise(repo.deleteAsset('photos/hero'));
    expect(ctx.store.has('photos/hero')).toBe(false);
  });

  it('rejects MIME types outside the allow-list', async () => {
    const repo = new S3AssetsRepository({
      client: new S3Client({ region: 'us-east-1' }),
      bucket: BUCKET,
      allowedMimeTypes: ['image/png', 'image/jpeg'],
    });
    await expect(
      LaikaTask.runPromise(
        repo.createAsset({ key: 'bad', content: tinyPng(), mimeType: 'application/x-msdownload' }),
      ),
    ).rejects.toThrow(/Disallowed MIME type/);
  });

  it('deleteAssets reports per-key outcomes', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'a', content: tinyPng(), mimeType: 'image/png' }),
    );
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'b', content: tinyPng(), mimeType: 'image/png' }),
    );

    const collected = await LaikaStream.runPromiseCollect(repo.deleteAssets(['a', 'b']));
    expect(collected.data.sort()).toEqual(['a', 'b']);
    expect(collected.done).toEqual({ removed: 2, skipped: 0 });
  });
});

describe('S3AssetsRepository URLs and variations', () => {
  it('builds a deterministic URL for an asset via the default `urlFor`', async () => {
    const repo = makeRepo();
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'photos/hero', content: tinyPng(), mimeType: 'image/png' }),
    );
    const collected = await LaikaStream.runPromiseCollect(repo.getUrls([asset]));
    expect(collected.data[0].url).toBe(`https://${BUCKET}.s3.amazonaws.com/photos/hero`);
  });

  it('applies each variation spec to the asset key, in zero round-trips', async () => {
    const repo = makeRepo();
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'photo', content: tinyPng(), mimeType: 'image/png' }),
    );

    const collected = await LaikaStream.runPromiseCollect(repo.getVariations([asset]));
    expect(collected.data).toHaveLength(1);
    const variations = collected.data[0].variations;

    expect(variations.thumbnail.url).toBe(`https://cdn.example.com/100x100/${BUCKET}/photo`);
    expect(variations.thumbnail.width).toBe(100);
    expect(variations.medium.url).toBe(`https://cdn.example.com/800/${BUCKET}/photo`);
  });

  it('honours `urlFor` overrides (CloudFront-style)', async () => {
    const repo = new S3AssetsRepository({
      client: new S3Client({ region: 'us-east-1' }),
      bucket: BUCKET,
      urlFor: ({ key }) => `https://cdn.example.com/${key}`,
    });
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'hello', content: tinyPng(), mimeType: 'image/png' }),
    );
    const collected = await LaikaStream.runPromiseCollect(repo.getUrls([asset]));
    expect(collected.data[0].url).toBe('https://cdn.example.com/hello');
  });
});

describe('S3AssetsRepository metadata', () => {
  it('returns ImageMetadata when width/height user-metadata hints are present', async () => {
    const repo = makeRepo();
    const asset = await LaikaTask.runPromise(
      repo.createAsset({
        key: 'photo',
        content: tinyPng(),
        mimeType: 'image/png',
        customMetadata: { width: '1200', height: '630' },
      }),
    );

    const collected = await LaikaStream.runPromiseCollect(repo.getMetadata([asset]));
    const meta = collected.data[0].metadata;
    expect(meta.kind).toBe('image');
    if (meta.kind === 'image') {
      expect(meta.width).toBe(1200);
      expect(meta.height).toBe(630);
      expect(meta.mimeType).toBe('image/png');
    }
  });

  it('falls back to BinaryMetadata when no width/height hints are attached', async () => {
    const repo = makeRepo();
    const asset = await LaikaTask.runPromise(
      repo.createAsset({ key: 'doc', content: tinyPng(), mimeType: 'application/pdf' }),
    );

    const collected = await LaikaStream.runPromiseCollect(repo.getMetadata([asset]));
    expect(collected.data[0].metadata.kind).toBe('binary');
  });
});

describe('S3AssetsRepository folders + listing', () => {
  it('lists folders (via common prefixes) and assets under a folder', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'photos' }));
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'photos/hero', content: tinyPng(), mimeType: 'image/png' }),
    );
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'photos/sub/nested', content: tinyPng(), mimeType: 'image/png' }),
    );

    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('photos', { pagination: { offset: 0, limit: 100 }, depth: 1 }),
    );

    const byKey = Object.fromEntries(collected.data.map(r => [r.key, r.type] as const));
    expect(byKey['photos/hero']).toBe('asset');
    expect(byKey['photos/sub']).toBe('folder');
    expect(byKey['photos/sub/nested']).toBeUndefined(); // direct children only
  });

  it('refuses to delete a non-empty folder unless `recursive: true`', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createAsset({ key: 'photos/a', content: tinyPng(), mimeType: 'image/png' }),
    );

    await expect(
      LaikaTask.runPromise(repo.deleteFolder('photos')),
    ).rejects.toThrow(/non-empty/);

    await LaikaTask.runPromise(repo.deleteFolder('photos', true));
    expect(ctx.store.has('photos/a')).toBe(false);
  });

  it('reports missing folder as NotFoundError on direct getFolder', async () => {
    await expect(
      LaikaTask.runPromise(makeRepo().getFolder('does/not/exist')),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('S3AssetsRepository basePath isolation', () => {
  it('honours `basePath` — paths above the configured prefix are invisible', async () => {
    const repoA = makeRepo('site-a/assets');
    await LaikaTask.runPromise(
      repoA.createAsset({ key: 'photo', content: tinyPng(), mimeType: 'image/png' }),
    );

    // Underlying S3 key should include the basePath.
    expect(ctx.store.has('site-a/assets/photo')).toBe(true);
    expect(ctx.store.has('photo')).toBe(false);

    const repoB = makeRepo('site-b/assets');
    await expect(
      LaikaTask.runPromise(repoB.getAsset('photo')),
    ).rejects.toThrow(NotFoundError);
  });
});
