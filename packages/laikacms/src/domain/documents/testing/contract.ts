import type { Document, DocumentsRepository, Revision, RevisionSummary, Unpublished } from 'laikacms/documents';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectStream, runTask } from '../../../shared/core/compat.js';
import { NotFoundError } from '../../../shared/core/index.js';

export type DocumentsContractCapability =
  | 'createDocument'
  | 'updateDocument'
  | 'deleteDocument'
  | 'listRecords'
  | 'listRecordSummaries'
  | 'createUnpublished'
  | 'updateUnpublished'
  | 'deleteUnpublished'
  | 'publishWorkflow'
  | 'unpublishWorkflow'
  | 'createRevision'
  | 'listRevisions';

export interface DocumentsContractCase {
  name: string;
  makeRepo: () => DocumentsRepository | Promise<DocumentsRepository>;
  teardown?: () => void | Promise<void>;
  skip?: DocumentsContractCapability[];
  /**
   * Optional folder name to scope created keys under. Some impls (e.g.
   * content-base on top of an Obsidian vault) require keys to live inside a
   * configured collection directory.
   */
  collectionFolder?: string;
  /**
   * Optional collection key. Defaults to 'posts'. Must match a collection
   * the impl's settings provider knows about.
   */
  collection?: string;
}

const DEFAULT_PAGINATION = { offset: 0, limit: 100 };

export function runDocumentsRepositoryContract(testCase: DocumentsContractCase): void {
  const { name, makeRepo, teardown, skip = [], collectionFolder = 'posts' } = testCase;

  describe(`DocumentsRepository contract: ${name}`, () => {
    let repo: DocumentsRepository;

    beforeAll(async () => {
      repo = await makeRepo();
    });

    if (teardown) {
      afterAll(async () => {
        await teardown();
      });
    }

    const itOrSkip = (capability: DocumentsContractCapability) => skip.includes(capability) ? it.skip : it;

    const keyIn = (folder: string, slug: string) => `${folder}/${slug}`;

    it('getCapabilities: returns a Capabilities value', async () => {
      const caps = await runTask(repo.getCapabilities());
      expect(caps).toBeDefined();
      expect(typeof caps.compatibilityDate).toBe('string');
      expect(caps.pagination).toBeDefined();
    });

    // --- createDocument then getDocument ---
    itOrSkip('createDocument')('createDocument then getDocument: round-trips content', async () => {
      const key = keyIn(collectionFolder, `create-doc-${Date.now()}`);
      const content = { title: 'Hello', n: 42 };

      const created: Document = await runTask(
        repo.createDocument({ key, type: 'published', status: 'published', content, language: 'en' }),
      );
      expect(created.key).toBe(key);
      expect(created.type).toBe('published');
      expect(created.status).toBe('published');
      expect(created.language).toBe('en');
      expect(created.content).toMatchObject(content);

      const fetched: Document = await runTask(repo.getDocument(key));
      expect(fetched.key).toBe(key);
      expect(fetched.type).toBe('published');
      expect(fetched.content).toMatchObject(content);
    });

    // --- updateDocument ---
    itOrSkip('updateDocument')('updateDocument: getDocument reflects new content', async () => {
      const key = keyIn(collectionFolder, `update-doc-${Date.now()}`);
      const initialContent = { title: 'v1' };
      const updatedContent = { title: 'v2' };

      await runTask(
        repo.createDocument({
          key,
          type: 'published',
          status: 'published',
          content: initialContent,
          language: 'en',
        }),
      );
      const updated: Document = await runTask(repo.updateDocument({ key, content: updatedContent }));
      expect(updated.key).toBe(key);
      expect(updated.content).toMatchObject(updatedContent);

      const fetched: Document = await runTask(repo.getDocument(key));
      expect(fetched.content).toMatchObject(updatedContent);
    });

    // --- deleteDocument ---
    itOrSkip('deleteDocument')('deleteDocument: subsequent getDocument fails with NotFoundError', async () => {
      const key = keyIn(collectionFolder, `delete-doc-${Date.now()}`);
      await runTask(
        repo.createDocument({ key, type: 'published', status: 'published', content: {}, language: 'en' }),
      );
      await runTask(repo.deleteDocument(key));

      await expect(runTask(repo.getDocument(key))).rejects.toMatchObject({ code: NotFoundError.CODE });
    });

    // --- listRecords ---
    itOrSkip('listRecords')('listRecords after create: returns created docs', async () => {
      const stamp = Date.now();
      const keys = [
        keyIn(collectionFolder, `list-a-${stamp}`),
        keyIn(collectionFolder, `list-b-${stamp}`),
        keyIn(collectionFolder, `list-c-${stamp}`),
      ];

      for (const key of keys) {
        await runTask(
          repo.createDocument({
            key,
            type: 'published',
            status: 'published',
            content: { key },
            language: 'en',
          }),
        );
      }

      const { items } = await collectStream(
        repo.listRecords({
          folder: collectionFolder,
          depth: 1,
          pagination: DEFAULT_PAGINATION,
        }),
      );
      const returnedKeys = (items as ReadonlyArray<unknown> as Array<{ key?: string }>)
        .map(r => r.key)
        .filter((k): k is string => typeof k === 'string');
      for (const key of keys) {
        expect(returnedKeys).toContain(key);
      }
    });

    // --- listRecordSummaries ---
    itOrSkip('listRecordSummaries')(
      'listRecordSummaries after create: returns created docs',
      async () => {
        const stamp = Date.now();
        const keys = [
          keyIn(collectionFolder, `summary-a-${stamp}`),
          keyIn(collectionFolder, `summary-b-${stamp}`),
        ];
        for (const key of keys) {
          await runTask(
            repo.createDocument({
              key,
              type: 'published',
              status: 'published',
              content: { key },
              language: 'en',
            }),
          );
        }

        const { items } = await collectStream(
          repo.listRecordSummaries({
            folder: collectionFolder,
            depth: 1,
            pagination: DEFAULT_PAGINATION,
          }),
        );
        const returnedKeys = (items as ReadonlyArray<unknown> as Array<{ key?: string }>)
          .map(s => s.key)
          .filter((k): k is string => typeof k === 'string');
        for (const key of keys) {
          expect(returnedKeys).toContain(key);
        }
      },
    );

    // --- createUnpublished then getUnpublished ---
    itOrSkip('createUnpublished')(
      'createUnpublished then getUnpublished: round-trips content',
      async () => {
        const key = keyIn(collectionFolder, `create-draft-${Date.now()}`);
        const content = { title: 'Draft', stage: 'wip' };

        const created: Unpublished = await runTask(
          repo.createUnpublished({
            key,
            type: 'unpublished',
            status: 'draft',
            content,
            language: 'en',
          }),
        );
        expect(created.key).toBe(key);
        expect(created.type).toBe('unpublished');
        expect(created.status).toBe('draft');
        expect(created.content).toMatchObject(content);

        const fetched: Unpublished = await runTask(repo.getUnpublished(key));
        expect(fetched.key).toBe(key);
        expect(fetched.content).toMatchObject(content);
      },
    );

    // --- updateUnpublished ---
    itOrSkip('updateUnpublished')(
      'updateUnpublished: getUnpublished reflects new content',
      async () => {
        const key = keyIn(collectionFolder, `update-draft-${Date.now()}`);
        await runTask(
          repo.createUnpublished({
            key,
            type: 'unpublished',
            status: 'draft',
            content: { v: 1 },
            language: 'en',
          }),
        );
        const updated: Unpublished = await runTask(
          repo.updateUnpublished({ key, content: { v: 2 } }),
        );
        expect(updated.content).toMatchObject({ v: 2 });

        const fetched: Unpublished = await runTask(repo.getUnpublished(key));
        expect(fetched.content).toMatchObject({ v: 2 });
      },
    );

    // --- deleteUnpublished ---
    itOrSkip('deleteUnpublished')(
      'deleteUnpublished: subsequent getUnpublished fails with NotFoundError',
      async () => {
        const key = keyIn(collectionFolder, `delete-draft-${Date.now()}`);
        await runTask(
          repo.createUnpublished({
            key,
            type: 'unpublished',
            status: 'draft',
            content: {},
            language: 'en',
          }),
        );
        await runTask(repo.deleteUnpublished(key));

        await expect(runTask(repo.getUnpublished(key))).rejects.toMatchObject({ code: NotFoundError.CODE });
      },
    );

    // --- publish: unpublished → published ---
    itOrSkip('publishWorkflow')(
      'publish: createUnpublished then publish → getDocument succeeds',
      async () => {
        const key = keyIn(collectionFolder, `publish-${Date.now()}`);
        await runTask(
          repo.createUnpublished({
            key,
            type: 'unpublished',
            status: 'draft',
            content: { ready: true },
            language: 'en',
          }),
        );

        const published: Document = await runTask(repo.publish(key));
        expect(published.type).toBe('published');
        expect(published.key).toBe(key);

        const fetched: Document = await runTask(repo.getDocument(key));
        expect(fetched.key).toBe(key);
        expect(fetched.content).toMatchObject({ ready: true });
      },
    );

    // --- unpublish: published → unpublished ---
    itOrSkip('unpublishWorkflow')(
      'unpublish: createDocument then unpublish(draft) → getUnpublished succeeds',
      async () => {
        const key = keyIn(collectionFolder, `unpublish-${Date.now()}`);
        await runTask(
          repo.createDocument({
            key,
            type: 'published',
            status: 'published',
            content: { headline: 'live' },
            language: 'en',
          }),
        );

        const unpublished: Unpublished = await runTask(repo.unpublish(key, 'draft'));
        expect(unpublished.type).toBe('unpublished');
        expect(unpublished.status).toBe('draft');
        expect(unpublished.key).toBe(key);

        const fetched: Unpublished = await runTask(repo.getUnpublished(key));
        expect(fetched.content).toMatchObject({ headline: 'live' });
      },
    );

    // --- createRevision then getRevision ---
    itOrSkip('createRevision')(
      'createRevision then getRevision: round-trips revision content',
      async () => {
        const key = keyIn(collectionFolder, `revision-${Date.now()}`);
        const rev = 'v1';
        const content = { text: 'original' };

        const created: Revision = await runTask(
          repo.createRevision({ key, type: 'revision', revision: rev, content, language: 'en' }),
        );
        expect(created.revision).toBe(rev);
        expect(created.content).toMatchObject(content);

        const fetched: Revision = await runTask(repo.getRevision(key, rev));
        expect(fetched.revision).toBe(rev);
        expect(fetched.content).toMatchObject(content);
      },
    );

    // --- listRevisions ---
    itOrSkip('listRevisions')('listRevisions after create: returns created revisions', async () => {
      const key = keyIn(collectionFolder, `list-rev-${Date.now()}`);
      const revs = ['v1', 'v2'];
      for (const rev of revs) {
        await runTask(
          repo.createRevision({
            key,
            type: 'revision',
            revision: rev,
            content: { rev },
            language: 'en',
          }),
        );
      }

      const { items } = await collectStream(
        repo.listRevisions(key, { pagination: DEFAULT_PAGINATION }),
      );
      const returnedRevs = (items as RevisionSummary[]).map(s => s.revision);
      for (const rev of revs) {
        expect(returnedRevs).toContain(rev);
      }
    });
  });
}
