import { describe, expect, it, vi } from 'vitest';

import { LaikaStream, LaikaTask } from 'laikacms/core';

import { R2AssetsRepository } from './r2-assets-repository.js';

type StoredAsset = { key: string, body: Uint8Array, uploaded: Date, etag: string };

let etagCounter = 0;

const makeBucket = (forbiddenPrefix?: string) => {
  const store = new Map<string, StoredAsset>();

  const toR2 = (a: StoredAsset) => ({
    key: a.key,
    size: a.body.byteLength,
    etag: a.etag,
    uploaded: a.uploaded,
    httpMetadata: undefined,
    customMetadata: undefined,
  });

  return {
    store,
    async head(key: string) {
      const a = store.get(key);
      if (!a) return null;
      return toR2(a);
    },
    async put(key: string, body: Uint8Array) {
      const stored: StoredAsset = {
        key,
        body,
        uploaded: new Date('2026-01-01T00:00:00Z'),
        etag: `etag-${++etagCounter}`,
      };
      store.set(key, stored);
      return toR2(stored);
    },
    async list(opts: { prefix?: string, delimiter?: string, cursor?: string }) {
      if (forbiddenPrefix !== undefined && opts.prefix === forbiddenPrefix) {
        throw new Error('boom: forbidden prefix');
      }
      const prefix = opts.prefix ?? '';
      const delim = opts.delimiter;
      const matching = Array.from(store.values())
        .filter(a => a.key.startsWith(prefix))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

      const objects: ReturnType<typeof toR2>[] = [];
      const delimitedPrefixSet = new Set<string>();
      for (const a of matching) {
        if (delim) {
          const tail = a.key.slice(prefix.length);
          const sepIdx = tail.indexOf(delim);
          if (sepIdx !== -1) {
            delimitedPrefixSet.add(prefix + tail.slice(0, sepIdx + delim.length));
            continue;
          }
        }
        objects.push(toR2(a));
      }
      return {
        objects,
        delimitedPrefixes: Array.from(delimitedPrefixSet).sort(),
        truncated: false,
        cursor: undefined,
      };
    },
  };
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * Bucket variant that simulates R2 eventual consistency: writes land
 * durably in `store`, but `head` / `get` against any key starting with
 * `simulateMissKey` return null (i.e. the readback hits the window).
 */
const makeEventualConsistencyBucket = (simulateMissKey: string) => {
  const store = new Map<string, StoredAsset>();
  return {
    store,
    async head(key: string) {
      if (key.startsWith(simulateMissKey)) return null;
      const a = store.get(key);
      if (!a) return null;
      return {
        size: a.body.byteLength,
        etag: a.etag,
        uploaded: a.uploaded,
        httpMetadata: undefined,
        customMetadata: undefined,
      };
    },
    async put(key: string, body: Uint8Array) {
      const stored: StoredAsset = {
        key,
        body,
        uploaded: new Date('2026-01-01T00:00:00Z'),
        etag: `etag-${++etagCounter}`,
      };
      store.set(key, stored);
      return {
        key,
        size: body.byteLength,
        etag: stored.etag,
        uploaded: stored.uploaded,
        httpMetadata: undefined,
        customMetadata: undefined,
      };
    },
    async list() {
      return { objects: [], delimitedPrefixes: [], truncated: false, cursor: undefined };
    },
  };
};

describe('R2AssetsRepository constructor', () => {
  it('constructs without error when dangerouslyAllowAllFiles: true (top-level key, no sanitizer)', () => {
    const bucket = makeBucket();
    expect(() =>
      new R2AssetsRepository({
        bucket: bucket as unknown as R2Bucket,
        dangerouslyAllowAllFiles: true,
      })
    ).not.toThrow();
  });

  it('constructs without error when a sanitizer is provided', () => {
    const bucket = makeBucket();
    const sanitizer = { sanitize: vi.fn().mockResolvedValue({ data: PNG }) };
    expect(() =>
      new R2AssetsRepository({
        bucket: bucket as unknown as R2Bucket,
        sanitizer,
      })
    ).not.toThrow();
  });

  it('does NOT call sanitize when dangerouslyAllowAllFiles: true', async () => {
    const bucket = makeBucket();
    await bucket.put('existing.png', PNG);
    const repo = new R2AssetsRepository({
      bucket: bucket as unknown as R2Bucket,
      dangerouslyAllowAllFiles: true,
    });
    // createAsset should succeed without any sanitizer being invoked
    const result = await LaikaTask.runPromiseCollect(
      repo.createAsset({ key: 'test.png', content: PNG, mimeType: 'image/png' }),
    );
    expect(result.value.key).toBe('test.png');
  });

  it('calls sanitize when a sanitizer is provided', async () => {
    const sanitizedBody = new Uint8Array([0x00, 0x01]);
    const sanitize = vi.fn().mockResolvedValue({ data: sanitizedBody });
    const bucket = makeBucket();
    const repo = new R2AssetsRepository({
      bucket: bucket as unknown as R2Bucket,
      sanitizer: { sanitize },
    });
    await LaikaTask.runPromiseCollect(
      repo.createAsset({ key: 'sanitized.png', content: PNG, mimeType: 'image/png' }),
    );
    expect(sanitize).toHaveBeenCalledOnce();
    expect(sanitize).toHaveBeenCalledWith(PNG, {}, 'image/png');
    // The bucket should have received the sanitized body, not the original
    expect(bucket.store.get('sanitized.png')?.body).toEqual(sanitizedBody);
  });
});

describe('R2AssetsRepository.createAsset', () => {
  it('falls back to a synthesized Asset + recoverableError when the readback hits the eventual-consistency window', async () => {
    const bucket = makeEventualConsistencyBucket('uploads/hello');
    const repo = new R2AssetsRepository({
      bucket: bucket as unknown as R2Bucket,
      dangerouslyAllowAllFiles: true,
    });

    const collected = await LaikaTask.runPromiseCollect(
      repo.createAsset({ key: 'uploads/hello.png', content: PNG, mimeType: 'image/png' }),
    );

    // The bytes are durably in the bucket.
    expect(bucket.store.has('uploads/hello.png')).toBe(true);

    // We still get a usable Asset back rather than a fatal failure.
    expect(collected.value.key).toBe('uploads/hello.png');
    expect(collected.value.content.size).toBe(PNG.byteLength);
    expect(collected.value.content.contentType).toBe('image/png');

    // …with a warning that the readback didn't verify.
    expect(collected.recoverableErrors.length).toBeGreaterThan(0);
  });
});

describe('R2AssetsRepository.listResources', () => {
  it('surfaces a failing subfolder listing as recoverableError + still returns siblings', async () => {
    const bucket = makeBucket('forbidden/');
    await bucket.put('good/a.png', PNG);
    await bucket.put('forbidden/secret.png', PNG);

    const repo = new R2AssetsRepository({
      bucket: bucket as unknown as R2Bucket,
      dangerouslyAllowAllFiles: true,
    });

    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('', { depth: 3, pagination: { offset: 0, limit: 100 } }),
    );

    const keys = collected.data.map(r => r.key).sort();
    // 'good' folder + its child are visible; 'forbidden' is listed as a folder
    // but its contents could not be enumerated.
    expect(keys).toContain('good');
    expect(keys).toContain('good/a.png');
    expect(keys).toContain('forbidden');
    expect(keys).not.toContain('forbidden/secret.png');
    expect(collected.recoverableErrors.length).toBeGreaterThan(0);
  });
});
