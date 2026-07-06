import { describe, expect, it } from 'vitest';

import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';

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

/**
 * Richer bucket mock that supports `list` with prefix/delimiter to exercise
 * listAtomSummaries / listAtoms pagination-total behaviour.
 */
const makeListableBucket = (keys: string[]) => {
  const store = new Map<string, { body: string, etag: string }>(
    keys.map((k, i) => [k, { body: '', etag: `etag-${i}` }]),
  );
  return {
    store,
    async head(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return { size: o.body.length, uploaded: new Date('2026-01-01'), etag: o.etag };
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return { size: o.body.length, uploaded: new Date('2026-01-01'), etag: o.etag, text: async () => o.body };
    },
    async put(key: string, body: string) {
      store.set(key, { body, etag: 'etag-put' });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix = '', delimiter }: { prefix?: string, delimiter?: string, cursor?: string }) {
      const allKeys = [...store.keys()];
      const matching = allKeys.filter(k => k.startsWith(prefix));
      if (!delimiter) {
        return {
          objects: matching.map(k => ({ key: k })),
          delimitedPrefixes: [] as string[],
          truncated: false,
          cursor: undefined,
        };
      }
      const objects: { key: string }[] = [];
      const prefixSet = new Set<string>();
      for (const k of matching) {
        const rest = k.slice(prefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx === -1) {
          objects.push({ key: k });
        } else {
          prefixSet.add(prefix + rest.slice(0, idx + 1));
        }
      }
      return {
        objects,
        delimitedPrefixes: [...prefixSet],
        truncated: false,
        cursor: undefined,
      };
    },
  };
};

describe('R2StorageRepository pagination total', () => {
  it('listAtomSummaries Done.total reflects aggregate count, not page count', async () => {
    const keys = ['item-1.json', 'item-2.json', 'item-3.json', 'item-4.json', 'item-5.json'];
    const bucket = makeListableBucket(keys);
    const repo = new R2StorageRepository(
      bucket as unknown as R2Bucket,
      { json: jsonSerializer },
      'json',
    );

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { page: 1, perPage: 2 }, depth: 1 }),
    );

    expect(collected.data).toHaveLength(2);
    expect(collected.done).toEqual({ total: 5 });
  });
});

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

describe('R2StorageRepository — missing folder recoverableError', () => {
  it('listAtomSummaries emits a NotFoundError recoverableError for a non-existent folder', async () => {
    const bucket = makeListableBucket(['other-collection/a.json', 'other-collection/b.json']);
    const repo = new R2StorageRepository(
      bucket as unknown as R2Bucket,
      { json: jsonSerializer },
      'json',
    );

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('nonexistent-folder', { pagination: {}, depth: 1 }),
    );

    expect(collected.data).toHaveLength(0);
    expect(collected.done).toEqual({ total: 0 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtoms emits a NotFoundError recoverableError for a non-existent folder', async () => {
    const bucket = makeListableBucket(['other-collection/a.json']);
    const repo = new R2StorageRepository(
      bucket as unknown as R2Bucket,
      { json: jsonSerializer },
      'json',
    );

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtoms('nonexistent-folder', { pagination: {}, depth: 1 }),
    );

    expect(collected.data).toHaveLength(0);
    expect(collected.done).toEqual({ total: 0 });
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries does NOT emit a recoverableError for an existing empty folder (.keep only)', async () => {
    const bucket = makeListableBucket(['my-collection/.keep']);
    const repo = new R2StorageRepository(
      bucket as unknown as R2Bucket,
      { json: jsonSerializer },
      'json',
    );

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('my-collection', { pagination: {}, depth: 1 }),
    );

    expect(collected.data).toHaveLength(0);
    expect(collected.done).toEqual({ total: 0 });
    expect(collected.recoverableErrors).toHaveLength(0);
  });
});

describe('R2StorageRepository — getCapabilities', () => {
  it('returns a compatibilityDate string and a pagination object', async () => {
    const bucket = makeBucket();
    const repo = new R2StorageRepository(
      bucket as unknown as R2Bucket,
      { json: jsonSerializer },
      'json',
    );
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(typeof caps.compatibilityDate).toBe('string');
    expect(caps.compatibilityDate.length).toBeGreaterThan(0);
    expect(caps.pagination).toBeDefined();
    expect(caps.pagination.supported).toBe(true);
  });
});
