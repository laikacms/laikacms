import * as fs from 'fs/promises';
import { BadRequestError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type { StorageSerializerRegistry } from 'laikacms/storage';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markdownSerializer } from '../../serializers/storage-serializers-markdown/index.js';
import { ObsidianDocumentsRepository } from './documents-repository.js';

let vaultDir: string;

beforeEach(async () => {
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-obsidian-test-'));
});

afterEach(async () => {
  await fs.rm(vaultDir, { recursive: true, force: true });
});

const registry = { md: markdownSerializer } as unknown as StorageSerializerRegistry;

const makeRepo = () =>
  new ObsidianDocumentsRepository(
    new FileSystemStorageRepository(vaultDir, registry, 'md'),
  );

describe('ObsidianDocumentsRepository — published vs. draft', () => {
  it('createDocument marks the note published and getDocument reads it back', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(repo.createDocument({
      key: 'notes/hello',
      type: 'published',
      status: 'published',
      language: 'en',
      content: { title: 'Hello', body: '# Hello' },
    }));

    expect(created.type).toBe('published');
    expect(created.content.publish).toBe(true);

    const fetched = await LaikaTask.runPromise(repo.getDocument('notes/hello'));
    expect(fetched.content.title).toBe('Hello');
    expect(fetched.language).toBe('en');

    // The on-disk note carries `publish: true` in its frontmatter.
    const raw = await fs.readFile(path.join(vaultDir, 'notes/hello.md'), 'utf8');
    expect(raw).toContain('publish: true');
  });

  it('getDocument fails with NotFoundError for an unpublished note', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createUnpublished({
      key: 'draft-note',
      type: 'unpublished',
      status: 'draft',
      language: 'und',
      content: { title: 'WIP', body: 'todo' },
    }));

    const result = await LaikaTask.runPromiseResult(repo.getDocument('draft-note'));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(NotFoundError);
  });

  it('publish promotes a draft and unpublish demotes a document', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createUnpublished({
      key: 'post',
      type: 'unpublished',
      status: 'pending_review',
      language: 'und',
      content: { title: 'Post', body: 'body' },
    }));

    const published = await LaikaTask.runPromise(repo.publish('post'));
    expect(published.type).toBe('published');
    expect(published.content.publish).toBe(true);
    expect(published.content.status).toBeUndefined();

    const unpublished = await LaikaTask.runPromise(repo.unpublish('post', 'archived'));
    expect(unpublished.type).toBe('unpublished');
    expect(unpublished.status).toBe('archived');
    expect(unpublished.content.publish).toBe(false);
  });
});

describe('ObsidianDocumentsRepository — listing', () => {
  it('listRecords returns both states and honours the type filter', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createDocument({
      key: 'a',
      type: 'published',
      status: 'published',
      language: 'und',
      content: { body: 'a' },
    }));
    await LaikaTask.runPromise(repo.createUnpublished({
      key: 'b',
      type: 'unpublished',
      status: 'draft',
      language: 'und',
      content: { body: 'b' },
    }));

    const all = await LaikaStream.runPromiseCollect(
      repo.listRecords({ folder: '', depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    expect(all.data.map(r => r.type).sort()).toEqual(['published', 'unpublished']);

    const publishedOnly = await LaikaStream.runPromiseCollect(
      repo.listRecords({
        folder: '',
        depth: 1,
        type: 'published',
        pagination: { offset: 0, limit: 100 },
      }),
    );
    expect(publishedOnly.data).toHaveLength(1);
    expect(publishedOnly.data[0]?.type).toBe('published');
  });
});

describe('ObsidianDocumentsRepository — revisions', () => {
  it('getRevision fails because Obsidian has no version history', async () => {
    const repo = makeRepo();
    const result = await LaikaTask.runPromiseResult(repo.getRevision('a', 'v1'));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(BadRequestError);
  });

  it('listRevisions yields an empty stream', async () => {
    const repo = makeRepo();
    const collected = await LaikaStream.runPromiseCollect(
      repo.listRevisions('a', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.done).toEqual({ total: 0 });
  });
});
