import { collectStream, runTask } from 'laikacms/compat';
import type { Atom, AtomSummary, Folder, StorageObject } from 'laikacms/storage';
import type { StorageRepository } from 'laikacms/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

export type StorageContractCapability =
  | 'createObject'
  | 'createOrUpdateObject'
  | 'updateObject'
  | 'createFolder'
  | 'listAtomSummaries'
  | 'listAtoms'
  | 'getAtom'
  | 'removeAtoms';

export interface StorageContractCase {
  /** Human-readable name shown in test output. */
  name: string;

  /** Return a fully-constructed, ready-to-use repository instance. */
  makeRepo(): Promise<StorageRepository>;

  /** Optional cleanup hook called after all contract tests finish. */
  teardown?(): Promise<void>;

  /** Capabilities to skip (not supported by this backend). */
  skip?: StorageContractCapability[];
}

const DEFAULT_PAGINATION = { offset: 0, limit: 100 };

export function runStorageRepositoryContract(testCase: StorageContractCase): void {
  const { name, makeRepo, teardown, skip = [] } = testCase;

  describe(`StorageRepository contract: ${name}`, () => {
    let repo: StorageRepository;

    beforeAll(async () => {
      repo = await makeRepo();
    });

    if (teardown) {
      afterAll(async () => {
        await teardown();
      });
    }

    const itOrSkip = (capability: StorageContractCapability) => skip.includes(capability) ? it.skip : it;

    // --- getCapabilities ---
    it('getCapabilities: returns a Capabilities value', async () => {
      const caps = await runTask(repo.getCapabilities());
      expect(caps).toBeDefined();
      expect(typeof caps.compatibilityDate).toBe('string');
      expect(caps.fileExtensions).toBeDefined();
      expect(caps.pagination).toBeDefined();
    });

    // --- createObject then getObject ---
    itOrSkip('createObject')('createObject then getObject: returns matching metadata/content', async () => {
      const key = `contract-test/create-object-${Date.now()}`;
      const content = { hello: 'world', num: 42 };
      const created: StorageObject = await runTask(
        repo.createObject({ key, type: 'object', content }),
      );
      expect(created.type).toBe('object');
      expect(created.key).toBe(key);
      expect(created.content).toMatchObject(content);

      const fetched: StorageObject = await runTask(repo.getObject(key));
      expect(fetched.key).toBe(key);
      expect(fetched.content).toMatchObject(content);
    });

    // --- createOrUpdateObject idempotent ---
    itOrSkip('createOrUpdateObject')('createOrUpdateObject idempotent: update reflects new content', async () => {
      const key = `contract-test/create-or-update-${Date.now()}`;
      const initialContent = { version: 1 };
      const updatedContent = { version: 2 };

      await runTask(repo.createOrUpdateObject({ key, type: 'object', content: initialContent }));
      await runTask(repo.createOrUpdateObject({ key, type: 'object', content: updatedContent }));

      const fetched: StorageObject = await runTask(repo.getObject(key));
      expect(fetched.content).toMatchObject(updatedContent);
    });

    // --- updateObject ---
    itOrSkip('updateObject')('updateObject: getObject reflects new content after update', async () => {
      const key = `contract-test/update-object-${Date.now()}`;
      const initialContent = { status: 'initial' };
      const updatedContent = { status: 'updated' };

      await runTask(repo.createObject({ key, type: 'object', content: initialContent }));
      const updated: StorageObject = await runTask(
        repo.updateObject({ key, content: updatedContent }),
      );
      expect(updated.content).toMatchObject(updatedContent);

      const fetched: StorageObject = await runTask(repo.getObject(key));
      expect(fetched.content).toMatchObject(updatedContent);
    });

    // --- createFolder then getFolder ---
    itOrSkip('createFolder')('createFolder then getFolder: returns the folder', async () => {
      const key = `contract-test/folder-${Date.now()}`;
      const created: Folder = await runTask(repo.createFolder({ key, type: 'folder' }));
      expect(created.type).toBe('folder');
      expect(created.key).toBe(key);

      const fetched: Folder = await runTask(repo.getFolder(key));
      expect(fetched.key).toBe(key);
      expect(fetched.type).toBe('folder');
    });

    // --- listAtoms after create ---
    itOrSkip('listAtoms')('listAtoms after create: created keys are present', async () => {
      const prefix = `contract-test/list-atoms-${Date.now()}`;
      const keys = [`${prefix}/a`, `${prefix}/b`, `${prefix}/c`];

      for (const key of keys) {
        await runTask(repo.createObject({ key, type: 'object', content: { key } }));
      }

      const { items } = await collectStream(
        repo.listAtoms(prefix, { depth: 1, pagination: DEFAULT_PAGINATION }),
      );
      const returnedKeys = (items as Atom[]).map(a => a.key);
      for (const key of keys) {
        expect(returnedKeys).toContain(key);
      }
    });

    // --- listAtomSummaries after create ---
    itOrSkip('listAtomSummaries')('listAtomSummaries after create: created keys are present', async () => {
      const prefix = `contract-test/list-summaries-${Date.now()}`;
      const keys = [`${prefix}/x`, `${prefix}/y`];

      for (const key of keys) {
        await runTask(repo.createObject({ key, type: 'object', content: { label: key } }));
      }

      const { items } = await collectStream(
        repo.listAtomSummaries(prefix, { depth: 1, pagination: DEFAULT_PAGINATION }),
      );
      const returnedKeys = (items as AtomSummary[]).map(s => s.key);
      for (const key of keys) {
        expect(returnedKeys).toContain(key);
      }
    });

    // --- getAtom for object ---
    itOrSkip('getAtom')('getAtom for object: returns an Atom', async () => {
      const key = `contract-test/get-atom-obj-${Date.now()}`;
      await runTask(repo.createObject({ key, type: 'object', content: { atom: true } }));

      const atom: Atom = await runTask(repo.getAtom(key));
      expect(atom.key).toBe(key);
      expect(atom.type).toBe('object');
    });

    // --- getAtom for folder ---
    itOrSkip('getAtom')('getAtom for folder: returns an Atom', async () => {
      const key = `contract-test/get-atom-folder-${Date.now()}`;
      await runTask(repo.createFolder({ key, type: 'folder' }));

      const atom: Atom = await runTask(repo.getAtom(key));
      expect(atom.key).toBe(key);
      expect(atom.type).toBe('folder');
    });

    // --- removeAtoms removes keys ---
    itOrSkip('removeAtoms')('removeAtoms: removes keys and reports removed > 0', async () => {
      const key1 = `contract-test/remove-${Date.now()}-1`;
      const key2 = `contract-test/remove-${Date.now()}-2`;
      await runTask(repo.createObject({ key: key1, type: 'object', content: {} }));
      await runTask(repo.createObject({ key: key2, type: 'object', content: {} }));

      const { done } = await collectStream(repo.removeAtoms([key1, key2]));
      expect(done.removed).toBeGreaterThan(0);
    });

    // --- removeAtoms missing key is warning not error ---
    itOrSkip('removeAtoms')('removeAtoms: missing key completes with skipped > 0', async () => {
      const missingKey = `contract-test/does-not-exist-${Date.now()}`;

      const { done } = await collectStream(repo.removeAtoms([missingKey]));
      expect(done.skipped).toBeGreaterThan(0);
    });
  });
}
