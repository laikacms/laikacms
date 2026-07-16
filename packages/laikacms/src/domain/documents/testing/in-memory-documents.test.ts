import { describe, expect, it } from 'vitest';

import { collectStream, runTask } from '../../../shared/core/compat.js';
import { InvalidData } from '../../../shared/core/index.js';

import { runDocumentsRepositoryContract } from './contract.js';
import { InMemoryDocumentsRepository } from './in-memory-documents.js';

// The in-memory reference implementation must satisfy the full documents
// contract, including the capability-gated version / sync token / change
// feed tests.
runDocumentsRepositoryContract({
  name: 'InMemoryDocumentsRepository (reference impl)',
  makeRepo: () => new InMemoryDocumentsRepository(),
});

describe('InMemoryDocumentsRepository change signals', () => {
  it('advertises versionTracking and changes capabilities', async () => {
    const repo = new InMemoryDocumentsRepository();
    const caps = await runTask(repo.getCapabilities());
    expect(caps.versionTracking).toMatchObject({ supported: true });
    expect(caps.changes).toMatchObject({ supported: true, syncToken: true, changeFeed: true });
  });

  it('scopes the sync token to a folder: unrelated writes leave it unchanged', async () => {
    const repo = new InMemoryDocumentsRepository();
    await runTask(
      repo.createDocument({ key: 'posts/a', type: 'published', status: 'published', content: {}, language: 'en' }),
    );
    const postsToken = await runTask(repo.getSyncToken({ folder: 'posts' }));

    await runTask(
      repo.createDocument({ key: 'pages/b', type: 'published', status: 'published', content: {}, language: 'en' }),
    );
    expect(await runTask(repo.getSyncToken({ folder: 'posts' }))).toBe(postsToken);

    await runTask(repo.updateDocument({ key: 'posts/a', content: { changed: true } }));
    expect(await runTask(repo.getSyncToken({ folder: 'posts' }))).not.toBe(postsToken);
  });

  it('listChanges collapses multiple writes to one entry per key and flags deletions', async () => {
    const repo = new InMemoryDocumentsRepository();
    const since = await runTask(repo.getSyncToken());

    await runTask(
      repo.createDocument({ key: 'posts/a', type: 'published', status: 'published', content: {}, language: 'en' }),
    );
    const updated = await runTask(repo.updateDocument({ key: 'posts/a', content: { v: 2 } }));
    await runTask(
      repo.createDocument({ key: 'posts/b', type: 'published', status: 'published', content: {}, language: 'en' }),
    );
    await runTask(repo.deleteDocument('posts/b'));

    const { items, done } = await collectStream(repo.listChanges({ since }));
    expect(items).toHaveLength(2);

    const a = items.find(c => c.key === 'posts/a');
    expect(a).toMatchObject({ deleted: false, version: updated.version });

    const b = items.find(c => c.key === 'posts/b');
    expect(b).toMatchObject({ deleted: true });
    expect(b!.version).toBeUndefined();

    expect(done.total).toBe(2);
    expect(done.syncToken).toBe(await runTask(repo.getSyncToken()));
  });

  it('listChanges honors the folder filter', async () => {
    const repo = new InMemoryDocumentsRepository();
    const since = await runTask(repo.getSyncToken());
    await runTask(
      repo.createDocument({ key: 'posts/a', type: 'published', status: 'published', content: {}, language: 'en' }),
    );
    await runTask(
      repo.createDocument({ key: 'pages/b', type: 'published', status: 'published', content: {}, language: 'en' }),
    );

    const { items } = await collectStream(repo.listChanges({ since, folder: 'pages' }));
    expect(items.map(c => c.key)).toEqual(['pages/b']);
  });

  it('listChanges rejects an unrecognized sync token', async () => {
    const repo = new InMemoryDocumentsRepository();
    await expect(
      collectStream(repo.listChanges({ since: 'not-a-token' as Parameters<typeof repo.listChanges>[0]['since'] })),
    ).rejects.toMatchObject({ code: InvalidData.CODE });
  });

  it('record summaries carry the same version as the full record', async () => {
    const repo = new InMemoryDocumentsRepository();
    const created = await runTask(
      repo.createDocument({
        key: 'posts/a',
        type: 'published',
        status: 'published',
        content: { title: 'A' },
        language: 'en',
      }),
    );

    const { items } = await collectStream(
      repo.listRecordSummaries({ folder: 'posts', depth: 1, pagination: { offset: 0, limit: 10 } }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'posts/a', version: created.version });
  });
});
