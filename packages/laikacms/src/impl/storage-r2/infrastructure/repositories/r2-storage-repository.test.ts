import { describe, expect, it } from 'vitest';

import { LaikaTask } from 'laikacms/core';

import { jsonSerializer } from '../../../../serializers/storage-serializers-json/index.js';
import { R2StorageRepository } from './r2-storage-repository.js';

type Stored = { key: string, body: string, uploaded: Date, etag: string };

/**
 * Simulates an R2 region under an eventual-consistency window where reads
 * for `simulateMissKey` never resolve, but writes durably land in `store`.
 * Used to assert createObject doesn't fail fatally when its post-write
 * readback hits the consistency window.
 */
const makeBucket = (simulateMissKey?: string) => {
  const store = new Map<string, Stored>();
  let etagCounter = 0;
  return {
    store,
    async head(key: string) {
      if (simulateMissKey !== undefined && key.startsWith(simulateMissKey)) return null;
      const o = store.get(key);
      if (!o) return null;
      return { size: o.body.length, uploaded: o.uploaded, etag: o.etag };
    },
    async get(key: string) {
      if (simulateMissKey !== undefined && key.startsWith(simulateMissKey)) return null;
      const o = store.get(key);
      if (!o) return null;
      return { size: o.body.length, uploaded: o.uploaded, etag: o.etag, text: async () => o.body };
    },
    async put(key: string, body: string) {
      store.set(key, { key, body, uploaded: new Date('2026-01-01T00:00:00Z'), etag: `etag-${++etagCounter}` });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { objects: [], delimitedPrefixes: [], truncated: false, cursor: undefined };
    },
  };
};

describe('R2StorageRepository.createObject', () => {
  it('falls back to a synthesized StorageObject + recoverableError when the readback hits the eventual-consistency window', async () => {
    const bucket = makeBucket('notes/hello');
    const repo = new R2StorageRepository(
      bucket as unknown as R2Bucket,
      { json: jsonSerializer },
      'json',
    );

    const collected = await LaikaTask.runPromiseCollect(
      repo.createObject({ key: 'notes/hello', type: 'object', content: { body: 'hi' } }),
    );

    // The write itself succeeded — the bytes are durably in the bucket.
    expect(bucket.store.has('notes/hello.json')).toBe(true);

    // We still get a usable StorageObject back rather than a fatal failure.
    expect(collected.value.key).toBe('notes/hello');
    expect(collected.value.content).toEqual({ body: 'hi' });
    expect(collected.value.metadata?.extension).toBe('json');

    // …with a warning that the readback didn't verify.
    expect(collected.recoverableErrors.length).toBeGreaterThan(0);
  });

  it('returns the canonical readback when consistency holds (no warnings)', async () => {
    const bucket = makeBucket();
    const repo = new R2StorageRepository(
      bucket as unknown as R2Bucket,
      { json: jsonSerializer },
      'json',
    );

    const collected = await LaikaTask.runPromiseCollect(
      repo.createObject({ key: 'notes/clean', type: 'object', content: { body: 'ok' } }),
    );

    expect(collected.value.content).toEqual({ body: 'ok' });
    expect(collected.recoverableErrors).toEqual([]);
  });
});
