import * as fs from 'fs/promises';
import { BadRequestError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type { StorageSerializerRegistry } from 'laikacms/storage';
import { FileSystemStorageRepository } from 'laikacms/storage/fs';
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

  it('listRecords done.total equals total matching records across all pages (not just current page)', async () => {
    const repo = makeRepo();
    // Create 4 published, 2 unpublished — natural-sort puts unpublished first
    await LaikaTask.runPromise(
      repo.createUnpublished({
        key: 'a-draft',
        type: 'unpublished',
        status: 'draft',
        language: 'und',
        content: { body: 'draft a' },
      }),
    );
    await LaikaTask.runPromise(
      repo.createUnpublished({
        key: 'b-draft',
        type: 'unpublished',
        status: 'draft',
        language: 'und',
        content: { body: 'draft b' },
      }),
    );
    await LaikaTask.runPromise(
      repo.createDocument({
        key: 'c-pub',
        type: 'published',
        status: 'published',
        language: 'und',
        content: { body: 'pub c' },
      }),
    );
    await LaikaTask.runPromise(
      repo.createDocument({
        key: 'd-pub',
        type: 'published',
        status: 'published',
        language: 'und',
        content: { body: 'pub d' },
      }),
    );
    await LaikaTask.runPromise(
      repo.createDocument({
        key: 'e-pub',
        type: 'published',
        status: 'published',
        language: 'und',
        content: { body: 'pub e' },
      }),
    );
    await LaikaTask.runPromise(
      repo.createDocument({
        key: 'f-pub',
        type: 'published',
        status: 'published',
        language: 'und',
        content: { body: 'pub f' },
      }),
    );

    // Limit smaller than total published count — natural-sort puts a-draft, b-draft first
    // so a page[limit=3] starting at offset 0 would only contain the 2 drafts + 1 published
    // if pagination preceded filtering. The correct total must be 4 (all published docs).
    const result = await LaikaStream.runPromiseCollect(
      repo.listRecords({ folder: '', depth: 1, type: 'published', pagination: { offset: 0, limit: 3 } }),
    );
    expect(result.data).toHaveLength(3);
    expect(result.data.every(r => r.type === 'published')).toBe(true);
    expect(result.done.total).toBe(4);
  });

  it('listRecordSummaries done.total equals total matching summaries across all pages', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createUnpublished({
        key: 'a-draft',
        type: 'unpublished',
        status: 'draft',
        language: 'und',
        content: { body: 'd' },
      }),
    );
    await LaikaTask.runPromise(
      repo.createDocument({
        key: 'b-pub',
        type: 'published',
        status: 'published',
        language: 'und',
        content: { body: 'p' },
      }),
    );
    await LaikaTask.runPromise(
      repo.createDocument({
        key: 'c-pub',
        type: 'published',
        status: 'published',
        language: 'und',
        content: { body: 'p' },
      }),
    );
    await LaikaTask.runPromise(
      repo.createDocument({
        key: 'd-pub',
        type: 'published',
        status: 'published',
        language: 'und',
        content: { body: 'p' },
      }),
    );

    const result = await LaikaStream.runPromiseCollect(
      repo.listRecordSummaries({ folder: '', depth: 1, type: 'published', pagination: { offset: 0, limit: 2 } }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.done.total).toBe(3);
  });
});

describe('ObsidianDocumentsRepository — revisions', () => {
  it('getRevision fails because Obsidian has no version history', async () => {
    const repo = makeRepo();
    const result = await LaikaTask.runPromiseResult(repo.getRevision('a', 'v1'));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(BadRequestError);
  });

  it('createRevision fails because Obsidian has no version history', async () => {
    const repo = makeRepo();
    const result = await LaikaTask.runPromiseResult(
      repo.createRevision({ key: 'a', type: 'revision', content: {}, language: 'und', revision: 'v1' }),
    );
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

describe("ObsidianDocumentsRepository — language: 'und' omits language key", () => {
  it("createDocument with language 'und' stores no language key in frontmatter", async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createDocument({
      key: 'und-doc',
      type: 'published',
      status: 'published',
      language: 'und',
      content: { title: 'Undetermined' },
    }));

    const raw = await fs.readFile(path.join(vaultDir, 'und-doc.md'), 'utf8');
    expect(raw).not.toContain('language:');
  });

  it("createUnpublished with language 'und' stores no language key in frontmatter", async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createUnpublished({
      key: 'und-draft',
      type: 'unpublished',
      status: 'draft',
      language: 'und',
      content: { title: 'Draft' },
    }));

    const raw = await fs.readFile(path.join(vaultDir, 'und-draft.md'), 'utf8');
    expect(raw).not.toContain('language:');
  });
});

describe('ObsidianDocumentsRepository — custom publishProperty option', () => {
  const makeCustomPublishRepo = () =>
    new ObsidianDocumentsRepository(
      new FileSystemStorageRepository(vaultDir, registry, 'md'),
      { publishProperty: 'published' },
    );

  it('createDocument writes the custom publish key to frontmatter', async () => {
    const repo = makeCustomPublishRepo();
    await LaikaTask.runPromise(repo.createDocument({
      key: 'my-post',
      type: 'published',
      status: 'published',
      language: 'en',
      content: { title: 'My Post' },
    }));

    const raw = await fs.readFile(path.join(vaultDir, 'my-post.md'), 'utf8');
    expect(raw).toContain('published: true');
    expect(raw).not.toContain('publish:');
  });

  it('getDocument reads published state from the custom publish key', async () => {
    const repo = makeCustomPublishRepo();
    await LaikaTask.runPromise(repo.createDocument({
      key: 'article',
      type: 'published',
      status: 'published',
      language: 'en',
      content: { title: 'Article' },
    }));

    const doc = await LaikaTask.runPromise(repo.getDocument('article'));
    expect(doc.type).toBe('published');
  });

  it('unpublish writes the custom publish key as false', async () => {
    const repo = makeCustomPublishRepo();
    await LaikaTask.runPromise(repo.createDocument({
      key: 'post',
      type: 'published',
      status: 'published',
      language: 'und',
      content: { title: 'Post' },
    }));
    await LaikaTask.runPromise(repo.unpublish('post', 'archived'));

    const raw = await fs.readFile(path.join(vaultDir, 'post.md'), 'utf8');
    expect(raw).toContain('published: false');
    expect(raw).not.toContain('publish:');
  });

  it('publish writes the custom publish key as true', async () => {
    const repo = makeCustomPublishRepo();
    await LaikaTask.runPromise(repo.createUnpublished({
      key: 'draft',
      type: 'unpublished',
      status: 'draft',
      language: 'und',
      content: { title: 'Draft' },
    }));
    await LaikaTask.runPromise(repo.publish('draft'));

    const raw = await fs.readFile(path.join(vaultDir, 'draft.md'), 'utf8');
    expect(raw).toContain('published: true');
    expect(raw).not.toContain('publish:');
  });
});

describe('ObsidianDocumentsRepository — custom statusProperty and defaultStatus options', () => {
  const makeCustomStatusRepo = (defaultStatus?: string) =>
    new ObsidianDocumentsRepository(
      new FileSystemStorageRepository(vaultDir, registry, 'md'),
      { statusProperty: 'stage', ...(defaultStatus ? { defaultStatus } : {}) },
    );

  it('createUnpublished writes the custom status key to frontmatter', async () => {
    const repo = makeCustomStatusRepo();
    await LaikaTask.runPromise(repo.createUnpublished({
      key: 'draft-note',
      type: 'unpublished',
      status: 'pending_review',
      language: 'und',
      content: { title: 'Draft' },
    }));

    const raw = await fs.readFile(path.join(vaultDir, 'draft-note.md'), 'utf8');
    expect(raw).toContain('stage: pending_review');
    expect(raw).not.toContain('status:');
  });

  it('getUnpublished reads status from the custom status key', async () => {
    const repo = makeCustomStatusRepo();
    await LaikaTask.runPromise(repo.createUnpublished({
      key: 'note',
      type: 'unpublished',
      status: 'in_progress',
      language: 'und',
      content: { title: 'Note' },
    }));

    const unpublished = await LaikaTask.runPromise(repo.getUnpublished('note'));
    expect(unpublished.status).toBe('in_progress');
  });

  it('defaultStatus is returned when the status property is absent from frontmatter', async () => {
    const repo = makeCustomStatusRepo('idea');
    await fs.writeFile(
      path.join(vaultDir, 'no-stage.md'),
      '---\npublish: false\ntitle: No Stage\n---\n',
    );

    const unpublished = await LaikaTask.runPromise(repo.getUnpublished('no-stage'));
    expect(unpublished.status).toBe('idea');
  });

  it('defaultStatus falls back to "draft" when not configured and status key is absent', async () => {
    const repo = makeCustomStatusRepo();
    await fs.writeFile(
      path.join(vaultDir, 'no-stage-default.md'),
      '---\npublish: false\ntitle: No Stage\n---\n',
    );

    const unpublished = await LaikaTask.runPromise(repo.getUnpublished('no-stage-default'));
    expect(unpublished.status).toBe('draft');
  });
});
