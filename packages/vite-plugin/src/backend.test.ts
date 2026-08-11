import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { DocumentCollectionSettings } from 'laikacms/catalog';
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { LaikaTask } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFsStorage, createRepositories, type LaikaRepositories, listKeys, readItem } from './backend.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-backend-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeRepos(): LaikaRepositories {
  return createRepositories(createFsStorage({ dir: tmpDir }));
}

/**
 * Register a document collection in the catalog settings file, so the
 * repository's root listing surfaces it as a folder (`listAllKeys` /
 * `listKeys(..., undefined)` walk into it) — otherwise an unregistered
 * collection's documents are reachable directly but invisible to a full
 * enumerate.
 */
async function registerCollection(repos: LaikaRepositories, name: string): Promise<void> {
  const settingsProvider = new ConventionCatalogProvider({ storage: repos.storage });
  const settings: DocumentCollectionSettings = { type: 'document', key: name, directory: name };
  await LaikaTask.runPromise(settingsProvider.putDocumentCollectionSettings(name, settings));
}

describe('readItem', () => {
  it('reads a store object, shaping meta from the object envelope', async () => {
    const repos = makeRepos();
    await LaikaTask.runPromise(
      repos.storage.createObject({ key: 'notes/hello', content: { title: 'Hi' } }),
    );

    const result = await readItem(repos, { namespace: 'store', key: 'notes/hello' });

    expect(result.content).toEqual({ title: 'Hi' });
    expect(result.meta.key).toBe('notes/hello');
    expect(result.meta.type).toBe('object');
  });

  it('reads a document, shaping meta from language/status instead of the storage envelope', async () => {
    const repos = makeRepos();
    await registerCollection(repos, 'posts');
    await LaikaTask.runPromise(
      repos.documents.createDocument({
        key: 'posts/hello',
        type: 'published',
        status: 'published',
        language: 'en',
        content: { title: 'Hello' },
      }),
    );

    const result = await readItem(repos, { namespace: 'doc', key: 'posts/hello' });

    expect(result.content).toEqual({ title: 'Hello', language: 'en' });
    expect(result.meta.key).toBe('posts/hello');
    expect(result.meta.language).toBe('en');
    expect(result.meta.status).toBe('published');
    // Storage-only fields must not leak onto a document's meta.
    expect(result.meta.type).toBeUndefined();
  });
});

describe('listKeys — store namespace', () => {
  it('lists only keys under an explicit folder', async () => {
    const repos = makeRepos();
    await LaikaTask.runPromise(repos.storage.createObject({ key: 'notes/a', content: {} }));
    await LaikaTask.runPromise(repos.storage.createObject({ key: 'notes/b', content: {} }));
    await LaikaTask.runPromise(repos.storage.createObject({ key: 'other/c', content: {} }));

    const keys = await listKeys(repos, 'store', 'notes');

    expect(keys.sort()).toEqual(['notes/a', 'notes/b']);
  });

  it('enumerates every key in the namespace when folder is undefined', async () => {
    const repos = makeRepos();
    await LaikaTask.runPromise(repos.storage.createObject({ key: 'notes/a', content: {} }));
    await LaikaTask.runPromise(repos.storage.createObject({ key: 'other/nested/c', content: {} }));

    const keys = await listKeys(repos, 'store', undefined);

    expect(keys.sort()).toEqual(['notes/a', 'other/nested/c']);
  });
});

describe('listKeys — doc namespace', () => {
  it('lists only published keys under an explicit collection folder', async () => {
    const repos = makeRepos();
    await registerCollection(repos, 'posts');
    await registerCollection(repos, 'pages');
    await LaikaTask.runPromise(
      repos.documents.createDocument({
        key: 'posts/one',
        type: 'published',
        status: 'published',
        language: 'en',
        content: {},
      }),
    );
    await LaikaTask.runPromise(
      repos.documents.createDocument({
        key: 'pages/about',
        type: 'published',
        status: 'published',
        language: 'en',
        content: {},
      }),
    );

    const keys = await listKeys(repos, 'doc', 'posts');

    expect(keys).toEqual(['posts/one']);
  });

  it(
    'walks folders one level deep to collect published keys across every collection when folder is undefined',
    async () => {
      const repos = makeRepos();
      await registerCollection(repos, 'posts');
      await registerCollection(repos, 'pages');
      await LaikaTask.runPromise(
        repos.documents.createDocument({
          key: 'posts/one',
          type: 'published',
          status: 'published',
          language: 'en',
          content: {},
        }),
      );
      await LaikaTask.runPromise(
        repos.documents.createDocument({
          key: 'posts/two',
          type: 'published',
          status: 'published',
          language: 'en',
          content: {},
        }),
      );
      await LaikaTask.runPromise(
        repos.documents.createDocument({
          key: 'pages/about',
          type: 'published',
          status: 'published',
          language: 'en',
          content: {},
        }),
      );

      const keys = await listKeys(repos, 'doc', undefined);

      expect(keys.sort()).toEqual(['pages/about', 'posts/one', 'posts/two']);
    },
  );

  it('omits unregistered collections from the full enumerate (root listing walks configured folders only)', async () => {
    const repos = makeRepos();
    await registerCollection(repos, 'posts');
    await LaikaTask.runPromise(
      repos.documents.createDocument({
        key: 'posts/one',
        type: 'published',
        status: 'published',
        language: 'en',
        content: {},
      }),
    );
    // Reachable directly (default collection settings), but never registered
    // in the catalog, so it does not surface as a root folder.
    await LaikaTask.runPromise(
      repos.documents.createDocument({
        key: 'drafts/orphan',
        type: 'published',
        status: 'published',
        language: 'en',
        content: {},
      }),
    );

    const keys = await listKeys(repos, 'doc', undefined);

    expect(keys).toEqual(['posts/one']);
  });
});
