import { LaikaStream, LaikaTask } from 'laikacms/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStorageRepository } from '../../domain/storage/testing/in-memory-storage.js';
import { TestSettingsProvider } from '../documents-contentbase/testing.js';
import { ContentBaseAssetsRepository } from './assets-repository.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// TestSettingsProvider maps any media collection to { key:'uploads', directory:'uploads' }
// so all asset keys must use 'uploads/<rest>' to route through the configured collection.
const KEY = (slug: string) => `uploads/${slug}`;

let repo: ContentBaseAssetsRepository;

beforeEach(() => {
  repo = new ContentBaseAssetsRepository(new InMemoryStorageRepository(), new TestSettingsProvider());
});

describe('ContentBaseAssetsRepository — getCapabilities', () => {
  it('returns a capabilities object with a compatibilityDate and pagination', async () => {
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(typeof caps.compatibilityDate).toBe('string');
    expect(caps.pagination).toBeDefined();
  });
});

describe('ContentBaseAssetsRepository — createAsset / getAsset', () => {
  it('round-trips: create then getAsset returns the same key and type', async () => {
    const key = KEY('photo.png');
    const created = await LaikaTask.runPromise(repo.createAsset({ key, content: PNG, mimeType: 'image/png' }));
    expect(created.type).toBe('asset');
    expect(created.key).toBe(key);

    const fetched = await LaikaTask.runPromise(repo.getAsset(key));
    expect(fetched.type).toBe('asset');
    expect(fetched.key).toBe(key);
    // toAssetContent maps stored mimeType → contentType
    expect(fetched.content.contentType).toBe('image/png');
    expect(fetched.content.size).toBe(PNG.length);
  });

  it('getAsset on a missing key throws NotFoundError', async () => {
    const result = await LaikaTask.runPromiseResult(repo.getAsset(KEY('ghost.png')));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure.code).toBe('not_found');
  });

  it('stores customMetadata and surfaces it in content', async () => {
    const key = KEY('tagged.png');
    await LaikaTask.runPromise(
      repo.createAsset({ key, content: PNG, mimeType: 'image/png', customMetadata: { owner: 'test' } }),
    );
    const fetched = await LaikaTask.runPromise(repo.getAsset(key));
    expect((fetched.content as Record<string, unknown>).customMetadata).toEqual({ owner: 'test' });
  });
});

describe('ContentBaseAssetsRepository — updateAsset', () => {
  it('updates mimeType metadata on an existing asset', async () => {
    const key = KEY('update-me.gif');
    await LaikaTask.runPromise(repo.createAsset({ key, content: PNG, mimeType: 'image/gif' }));

    const updated = await LaikaTask.runPromise(repo.updateAsset({ key, mimeType: 'image/png' }));
    expect(updated.key).toBe(key);
    // toAssetContent maps stored mimeType → contentType
    expect(updated.content.contentType).toBe('image/png');
  });

  it('updateAsset on a missing key throws NotFoundError', async () => {
    const result = await LaikaTask.runPromiseResult(repo.updateAsset({ key: KEY('none.png') }));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure.code).toBe('not_found');
  });
});

describe('ContentBaseAssetsRepository — deleteAsset', () => {
  it('removes the asset; subsequent getAsset throws NotFoundError', async () => {
    const key = KEY('to-delete.png');
    await LaikaTask.runPromise(repo.createAsset({ key, content: PNG, mimeType: 'image/png' }));
    await LaikaTask.runPromise(repo.deleteAsset(key));

    const result = await LaikaTask.runPromiseResult(repo.getAsset(key));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure.code).toBe('not_found');
  });
});

describe('ContentBaseAssetsRepository — deleteAssets (bulk)', () => {
  it('removes all specified keys and reports removed count', async () => {
    const k1 = KEY('bulk-1.png');
    const k2 = KEY('bulk-2.png');
    await LaikaTask.runPromise(repo.createAsset({ key: k1, content: PNG, mimeType: 'image/png' }));
    await LaikaTask.runPromise(repo.createAsset({ key: k2, content: PNG, mimeType: 'image/png' }));

    const { done } = await LaikaStream.runPromiseCollect(repo.deleteAssets([k1, k2]));
    expect(done.removed).toBeGreaterThan(0);
  });
});

describe('ContentBaseAssetsRepository — listResources', () => {
  it('done.total equals the full count, not the page count', async () => {
    for (let i = 0; i < 5; i++) {
      await LaikaTask.runPromise(
        repo.createAsset({ key: KEY(`gallery/img${i}.png`), content: PNG, mimeType: 'image/png' }),
      );
    }

    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('uploads/gallery', { depth: 1, pagination: { offset: 0, limit: 2 } }),
    );

    expect(collected.data).toHaveLength(2);
    expect(collected.done.total).toBe(5);
  });

  it('listResources with empty folderKey returns empty list instead of 400', async () => {
    await LaikaTask.runPromise(
      repo.createAsset({ key: KEY('root-test.png'), content: PNG, mimeType: 'image/png' }),
    );
    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toHaveLength(0);
    expect(collected.done.total).toBe(0);
  });

  it('lists assets created under a folder prefix', async () => {
    const k1 = KEY('gallery/a.png');
    const k2 = KEY('gallery/b.png');
    await LaikaTask.runPromise(repo.createAsset({ key: k1, content: PNG, mimeType: 'image/png' }));
    await LaikaTask.runPromise(repo.createAsset({ key: k2, content: PNG, mimeType: 'image/png' }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('uploads/gallery', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    const keys = collected.data.map(r => r.key);
    expect(keys).toContain(k1);
    expect(keys).toContain(k2);
  });
});

describe('ContentBaseAssetsRepository — getUrls', () => {
  it('returns one url entry per asset (defaults to the logical key when no url template)', async () => {
    const key = KEY('icon.png');
    const asset = await LaikaTask.runPromise(repo.createAsset({ key, content: PNG, mimeType: 'image/png' }));

    const { data } = await LaikaStream.runPromiseCollect(repo.getUrls([asset]));
    expect(data).toHaveLength(1);
    expect(data[0]?.key).toBe(key);
    expect(typeof data[0]?.url).toBe('string');
  });

  it('returns one url entry per asset when passed multiple assets', async () => {
    const k1 = KEY('url-1.png');
    const k2 = KEY('url-2.png');
    const a1 = await LaikaTask.runPromise(repo.createAsset({ key: k1, content: PNG, mimeType: 'image/png' }));
    const a2 = await LaikaTask.runPromise(repo.createAsset({ key: k2, content: PNG, mimeType: 'image/png' }));

    const { data } = await LaikaStream.runPromiseCollect(repo.getUrls([a1, a2]));
    expect(data).toHaveLength(2);
  });
});

describe('ContentBaseAssetsRepository — getVariations', () => {
  it('returns one variations entry per asset (empty variations map)', async () => {
    const key = KEY('var.png');
    const asset = await LaikaTask.runPromise(repo.createAsset({ key, content: PNG, mimeType: 'image/png' }));

    const { data } = await LaikaStream.runPromiseCollect(repo.getVariations([asset]));
    expect(data).toHaveLength(1);
    expect(data[0]?.key).toBe(key);
    expect(data[0]?.variations).toBeDefined();
  });

  it('invokes createVariations callback and surfaces result on the returned entry', async () => {
    const repoWithVariations = new ContentBaseAssetsRepository(
      new InMemoryStorageRepository(),
      new TestSettingsProvider(),
      { createVariations: key => ({ thumb: { variant: 'thumb', url: 'thumb-' + key } }) },
    );
    const key = KEY('cb.png');
    const asset = await LaikaTask.runPromise(
      repoWithVariations.createAsset({ key, content: PNG, mimeType: 'image/png' }),
    );

    const { data } = await LaikaStream.runPromiseCollect(repoWithVariations.getVariations([asset]));
    expect(data).toHaveLength(1);
    expect(data[0]?.key).toBe(key);
    expect(data[0]?.variations['thumb']).toEqual({ variant: 'thumb', url: 'thumb-' + key });
  });
});

describe('ContentBaseAssetsRepository — getMetadata', () => {
  it('reports binary kind with correct size and mimeType', async () => {
    const key = KEY('meta.png');
    const asset = await LaikaTask.runPromise(repo.createAsset({ key, content: PNG, mimeType: 'image/png' }));

    const { data } = await LaikaStream.runPromiseCollect(repo.getMetadata([asset]));
    expect(data).toHaveLength(1);
    expect(data[0]?.metadata.kind).toBe('binary');
    expect(data[0]?.metadata.size).toBe(PNG.length);
    expect(data[0]?.metadata.mimeType).toBe('image/png');
  });

  it('returns one metadata entry per asset for multiple assets', async () => {
    const k1 = KEY('meta-1.png');
    const k2 = KEY('meta-2.png');
    const a1 = await LaikaTask.runPromise(repo.createAsset({ key: k1, content: PNG, mimeType: 'image/png' }));
    const a2 = await LaikaTask.runPromise(repo.createAsset({ key: k2, content: PNG, mimeType: 'image/png' }));

    const { data } = await LaikaStream.runPromiseCollect(repo.getMetadata([a1, a2]));
    expect(data).toHaveLength(2);
  });
});

describe('ContentBaseAssetsRepository — folder operations', () => {
  it('createFolder then getFolder returns the folder', async () => {
    const key = KEY('my-folder');
    const created = await LaikaTask.runPromise(repo.createFolder({ key, type: 'folder' }));
    expect(created.type).toBe('folder');
    expect(created.key).toBe(key);

    const fetched = await LaikaTask.runPromise(repo.getFolder(key));
    expect(fetched.type).toBe('folder');
    expect(fetched.key).toBe(key);
  });

  it('deleteFolder removes the folder', async () => {
    const key = KEY('folder-to-delete');
    await LaikaTask.runPromise(repo.createFolder({ key, type: 'folder' }));
    await LaikaTask.runPromise(repo.deleteFolder(key));

    const result = await LaikaTask.runPromiseResult(repo.getFolder(key));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure.code).toBe('not_found');
  });
});
