/**
 * The loader against real Laika repositories.
 *
 * Two profiles are exercised deliberately:
 *
 * - `InMemoryDocumentsRepository`, which advertises version tracking *and* a
 *   change feed — the fully-capable end.
 * - `CatalogDocumentsRepository` over a real filesystem repository, which
 *   advertises neither. This is the zero-config path every starter uses, and
 *   the reason the digest tier exists.
 *
 * Running the same expectations over both is what makes "degrades cleanly" a
 * checked property rather than a claim in a README.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFsStorage, createRepositories } from '@laikacms/vite-plugin';
import { runTask } from 'laikacms/compat';
import type { DocumentsRepository } from 'laikacms/documents';
import { InMemoryDocumentsRepository } from 'laikacms/documents/testing';

import { createDocumentsSyncSource } from './documents-loader.js';
import { type SourceRecord, toDataEntry } from './mapping.js';
import { runSync } from './sync.js';
import { createFakeLoaderContext, type FakeLoaderContext } from './testing/loader-context.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

/** A filesystem-backed documents repository, wired exactly as the loader wires it. */
async function createFilesystemRepository(): Promise<DocumentsRepository> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-astro-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, 'posts'), { recursive: true });
  return createRepositories(createFsStorage({ dir, defaultExtension: 'md' })).documents;
}

const PROFILES = [
  {
    name: 'InMemoryDocumentsRepository (versions + change feed)',
    create: async (): Promise<DocumentsRepository> => new InMemoryDocumentsRepository(),
    expectedTier: 'changes',
  },
  {
    name: 'CatalogDocumentsRepository over the filesystem (no capabilities)',
    create: createFilesystemRepository,
    expectedTier: 'digest',
  },
] as const;

async function write(
  documents: DocumentsRepository,
  key: string,
  content: Record<string, unknown>,
): Promise<void> {
  try {
    await runTask(documents.updateDocument({ key, content }));
  } catch {
    await runTask(documents.createDocument({ key, content, language: 'en' }));
  }
}

function sync(documents: DocumentsRepository, fake: FakeLoaderContext) {
  const source = createDocumentsSyncSource(documents, 'posts', {});
  return runSync(source, {
    collection: 'posts',
    store: fake.store,
    meta: fake.meta,
    logger: fake.logger,
    entry: {},
    generateDigest: fake.generateDigest,
    refreshContextData: fake.refreshContextData,
    toEntry: (record: SourceRecord) =>
      toDataEntry(record, {
        collection: 'posts',
        entry: {},
        render: {},
        renderMarkdown: fake.renderMarkdown,
        generateDigest: fake.generateDigest,
        parseData: fake.parseData,
      }),
  }, {});
}

describe.each(PROFILES)('$name', ({ create, expectedTier }) => {
  it('picks the best tier the repository advertises', async () => {
    const documents = await create();
    await write(documents, 'posts/hello', { title: 'Hello', body: '# Hello' });
    const fake = createFakeLoaderContext({ collection: 'posts' });

    await sync(documents, fake);

    expect(fake.meta.get('laika:strategy')).toBe(expectedTier);
  });

  it('loads documents with frontmatter in data and the body rendered', async () => {
    const documents = await create();
    await write(documents, 'posts/hello', { title: 'Hello', body: '# Hello' });
    const fake = createFakeLoaderContext({ collection: 'posts' });

    await sync(documents, fake);

    const entry = fake.snapshot().get('hello');
    expect(entry?.data).toMatchObject({ title: 'Hello' });
    expect(entry?.data).not.toHaveProperty('body');
    // Trimmed: a repository that serializes to markdown round-trips the body
    // through gray-matter, which normalises the trailing newline. That is the
    // serializer's business, not the loader's.
    expect(entry?.body?.trim()).toBe('# Hello');
    expect(entry?.rendered?.html).toContain('# Hello');
  });

  it('strips the collection prefix from the entry id', async () => {
    const documents = await create();
    await write(documents, 'posts/nested/deep', { title: 'Deep' });
    const fake = createFakeLoaderContext({ collection: 'posts' });

    await sync(documents, fake);

    expect([...fake.snapshot().keys()]).toContain('nested/deep');
  });

  it('writes nothing on a second run when nothing changed', async () => {
    const documents = await create();
    await write(documents, 'posts/a', { title: 'A' });
    await write(documents, 'posts/b', { title: 'B' });
    const fake = createFakeLoaderContext({ collection: 'posts' });
    await sync(documents, fake);

    fake.resetTraffic();
    await sync(documents, fake);

    expect(fake.traffic.set).toEqual([]);
    expect(fake.traffic.delete).toEqual([]);
  });

  it('applies an edit', async () => {
    const documents = await create();
    await write(documents, 'posts/a', { title: 'A' });
    const fake = createFakeLoaderContext({ collection: 'posts' });
    await sync(documents, fake);

    await write(documents, 'posts/a', { title: 'A revised' });
    fake.resetTraffic();
    await sync(documents, fake);

    expect(fake.traffic.set).toEqual(['a']);
    expect(fake.snapshot().get('a')?.data).toMatchObject({ title: 'A revised' });
  });

  it('picks up a newly created document', async () => {
    const documents = await create();
    await write(documents, 'posts/a', { title: 'A' });
    const fake = createFakeLoaderContext({ collection: 'posts' });
    await sync(documents, fake);

    await write(documents, 'posts/b', { title: 'B' });
    fake.resetTraffic();
    await sync(documents, fake);

    expect(fake.snapshot().get('b')?.data).toMatchObject({ title: 'B' });
  });

  it('removes a deleted document', async () => {
    const documents = await create();
    await write(documents, 'posts/a', { title: 'A' });
    await write(documents, 'posts/b', { title: 'B' });
    const fake = createFakeLoaderContext({ collection: 'posts' });
    await sync(documents, fake);

    await runTask(documents.deleteDocument('posts/b'));
    fake.resetTraffic();
    await sync(documents, fake);

    expect(fake.snapshot().has('b')).toBe(false);
    expect(fake.snapshot().has('a')).toBe(true);
  });

  it('applies a pushed change without listing the repository', async () => {
    const documents = await create();
    await write(documents, 'posts/a', { title: 'A' });
    const fake = createFakeLoaderContext({ collection: 'posts' });
    await sync(documents, fake);

    await write(documents, 'posts/a', { title: 'A pushed' });
    fake.resetTraffic();

    const source = createDocumentsSyncSource(documents, 'posts', {});
    await runSync(source, {
      collection: 'posts',
      store: fake.store,
      meta: fake.meta,
      logger: fake.logger,
      entry: {},
      generateDigest: fake.generateDigest,
      refreshContextData: { laika: { changes: [{ key: 'posts/a', deleted: false }] } },
      toEntry: (record: SourceRecord) =>
        toDataEntry(record, {
          collection: 'posts',
          entry: {},
          render: {},
          renderMarkdown: fake.renderMarkdown,
          generateDigest: fake.generateDigest,
          parseData: fake.parseData,
        }),
    }, {});

    expect(fake.traffic.set).toEqual(['a']);
    expect(fake.snapshot().get('a')?.data).toMatchObject({ title: 'A pushed' });
  });
});

describe('capability reporting', () => {
  it('the filesystem + Catalog path advertises neither optional tier', async () => {
    // This is what makes the digest tier load-bearing rather than a fallback
    // nobody reaches. If this ever starts reporting `true`, the loader silently
    // gets faster — and this test is the thing that will tell us.
    const documents = await createFilesystemRepository();
    const source = createDocumentsSyncSource(documents, 'posts', {});

    expect(await source.capabilities()).toEqual({ changes: false, versions: false });
  });

  it('the in-memory repository advertises both', async () => {
    const source = createDocumentsSyncSource(new InMemoryDocumentsRepository(), 'posts', {});

    expect(await source.capabilities()).toEqual({ changes: true, versions: true });
  });
});

describe('scoping', () => {
  it('ownsKey accepts keys in the collection and rejects the rest', async () => {
    const source = createDocumentsSyncSource(new InMemoryDocumentsRepository(), 'posts', {});

    expect(source.ownsKey('posts/hello')).toBe(true);
    expect(source.ownsKey('posts/nested/hello')).toBe(true);
    expect(source.ownsKey('pages/hello')).toBe(false);
    // A prefix match must not accept a sibling collection whose name starts the same.
    expect(source.ownsKey('postscript/hello')).toBe(false);
  });

  it('a sub-folder narrows the scope', async () => {
    const source = createDocumentsSyncSource(
      new InMemoryDocumentsRepository(),
      'posts',
      { folder: '2026' },
    );

    expect(source.ownsKey('posts/2026/hello')).toBe(true);
    expect(source.ownsKey('posts/2025/hello')).toBe(false);
  });
});
