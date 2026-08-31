import { describe, expect, it } from 'vitest';

import { runTask } from 'laikacms/compat';
import { LaikaTask } from 'laikacms/core';
import { NotFoundError, NotImplementedError } from 'laikacms/core/errors';
import type { StorageObject } from 'laikacms/storage';
import { InMemoryStorageRepository } from 'laikacms/storage/testing';

import { createObjectsSyncSource, objectsLoader } from './objects-loader.js';
import { createFakeLoaderContext } from './testing/loader-context.js';

async function makeStorage(...keys: string[]): Promise<InMemoryStorageRepository> {
  const storage = new InMemoryStorageRepository();
  for (const key of keys) {
    await runTask(storage.createObject({ key, content: { title: key } }));
  }
  return storage;
}

describe('createObjectsSyncSource — capabilities', () => {
  it('always reports changes and versions as absent', async () => {
    const source = createObjectsSyncSource(new InMemoryStorageRepository(), 'settings', {});
    expect(await source.capabilities()).toEqual({ changes: false, versions: false });
  });
});

describe('createObjectsSyncSource — listSummaries', () => {
  it('returns one summary per object in the folder', async () => {
    const storage = await makeStorage('settings/nav', 'settings/footer');
    const source = createObjectsSyncSource(storage, 'settings', {});

    const summaries = await source.listSummaries();

    expect(summaries.map(s => s.key).sort()).toEqual(['settings/footer', 'settings/nav']);
  });

  it('does not return objects outside the folder', async () => {
    const storage = await makeStorage('settings/nav', 'other/nav');
    const source = createObjectsSyncSource(storage, 'settings', {});

    const summaries = await source.listSummaries();

    expect(summaries.map(s => s.key)).toEqual(['settings/nav']);
  });

  it('returns an empty list when the folder is empty', async () => {
    const source = createObjectsSyncSource(new InMemoryStorageRepository(), 'settings', {});
    expect(await source.listSummaries()).toEqual([]);
  });
});

describe('createObjectsSyncSource — listRecords', () => {
  it('returns key and content for each object', async () => {
    const storage = await makeStorage('cfg/a', 'cfg/b');
    const source = createObjectsSyncSource(storage, 'cfg', {});

    const records = await source.listRecords();

    expect(records.map(r => r.key).sort()).toEqual(['cfg/a', 'cfg/b']);
    expect(records.find(r => r.key === 'cfg/a')?.content).toMatchObject({ title: 'cfg/a' });
  });

  it('returns an empty list when there are no objects', async () => {
    const source = createObjectsSyncSource(new InMemoryStorageRepository(), 'cfg', {});
    expect(await source.listRecords()).toEqual([]);
  });
});

describe('createObjectsSyncSource — getRecord', () => {
  it('returns the record when the object exists', async () => {
    const storage = await makeStorage('data/item');
    const source = createObjectsSyncSource(storage, 'data', {});

    const record = await source.getRecord('data/item');

    expect(record).toMatchObject({ key: 'data/item', content: { title: 'data/item' } });
  });

  it('returns undefined for a NotFoundError', async () => {
    const source = createObjectsSyncSource(new InMemoryStorageRepository(), 'data', {});
    expect(await source.getRecord('data/missing')).toBeUndefined();
  });

  it('rethrows errors that are not NotFoundError', async () => {
    class BrokenStorage extends InMemoryStorageRepository {
      override getObject(_key: string): LaikaTask.LaikaTask<StorageObject> {
        return LaikaTask.fail(new Error('unexpected internal error'));
      }
    }
    const source = createObjectsSyncSource(new BrokenStorage(), 'data', {});
    await expect(source.getRecord('data/anything')).rejects.toThrow('unexpected internal error');
  });
});

describe('createObjectsSyncSource — getSyncToken / listChanges', () => {
  it('getSyncToken throws NotImplementedError', () => {
    const source = createObjectsSyncSource(new InMemoryStorageRepository(), 'settings', {});
    expect(() => source.getSyncToken()).toThrow(NotImplementedError);
  });

  it('listChanges throws NotImplementedError', () => {
    const source = createObjectsSyncSource(new InMemoryStorageRepository(), 'settings', {});
    expect(() => source.listChanges('any-token')).toThrow(NotImplementedError);
  });
});

describe('createObjectsSyncSource — ownsKey', () => {
  it('accepts keys within the folder', () => {
    const source = createObjectsSyncSource(new InMemoryStorageRepository(), 'settings', {});
    expect(source.ownsKey('settings/nav')).toBe(true);
    expect(source.ownsKey('settings/nested/deep')).toBe(true);
  });

  it('rejects keys outside the folder', () => {
    const source = createObjectsSyncSource(new InMemoryStorageRepository(), 'settings', {});
    expect(source.ownsKey('other/nav')).toBe(false);
  });

  it('rejects a sibling folder whose name starts the same', () => {
    const source = createObjectsSyncSource(new InMemoryStorageRepository(), 'set', {});
    expect(source.ownsKey('settings/nav')).toBe(false);
  });
});

describe('objectsLoader — smoke', () => {
  it('builds a loader object without crashing when called with no options', () => {
    const loader = objectsLoader();
    expect(loader).toHaveProperty('name', 'laikacms:objects');
    expect(typeof loader.load).toBe('function');
  });

  it('respects a custom name option', () => {
    const loader = objectsLoader({ name: 'my:objects' });
    expect(loader.name).toBe('my:objects');
  });

  it('does not add createSchema when z or folder are absent', () => {
    expect(objectsLoader()).not.toHaveProperty('createSchema');
    expect(objectsLoader({ select: { folder: 'cfg' } })).not.toHaveProperty('createSchema');
  });

  it('loads objects from a storage repository into the store', async () => {
    const storage = await makeStorage('items/a', 'items/b');
    const fake = createFakeLoaderContext({ collection: 'items' });

    await objectsLoader({ storage }).load(
      {
        collection: fake.collection,
        store: fake.store,
        meta: fake.meta,
        logger: fake.logger,
        generateDigest: fake.generateDigest,
        renderMarkdown: fake.renderMarkdown,
        parseData: fake.parseData,
        config: { root: new URL('file:///tmp/') },
      } as Parameters<ReturnType<typeof objectsLoader>['load']>[0],
    );

    expect([...fake.snapshot().keys()].sort()).toEqual(['a', 'b']);
  });
});
