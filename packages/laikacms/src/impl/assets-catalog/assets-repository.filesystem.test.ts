import * as fs from 'fs/promises';
import { LaikaStream, LaikaTask } from 'laikacms/core';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { jsonSerializer } from '../../serializers/storage-serializers-json/index.js';
import { TestSettingsProvider } from '../documents-catalog/testing.js';
import { FileSystemStorageRepository } from '../storage-fs/infrastructure/repositories/filesystem-repository.js';
import { CatalogAssetsRepository } from './assets-repository.js';

// Regression coverage for LCMS-540: FileSystemDataSource.stripExtension used to
// truncate at ANY dot, so an asset key like `uploads/pic.png` round-tripped as
// `uploads/pic` once it passed through the real storage-fs datasource. The
// existing assets-repository.test.ts suite only exercises InMemoryStorageRepository,
// which never truncates anything, so it never caught this. These tests wire the
// real FileSystemStorageRepository (with only a `json` serializer registered,
// matching the documented FS + Catalog media setup) to prove the asset
// extension survives create/get/list.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let tmpDir: string;
let repo: CatalogAssetsRepository;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-assets-fs-test-'));
  const storage = new FileSystemStorageRepository(tmpDir, { json: jsonSerializer }, 'json');
  repo = new CatalogAssetsRepository(storage, new TestSettingsProvider());
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('CatalogAssetsRepository over real FileSystemStorageRepository (LCMS-540)', () => {
  it('createAsset + getAsset round-trip uploads/pic.png with the extension intact', async () => {
    const key = 'uploads/pic.png';
    const created = await LaikaTask.runPromise(repo.createAsset({ key, content: PNG, mimeType: 'image/png' }));
    expect(created.key).toBe(key);

    const fetched = await LaikaTask.runPromise(repo.getAsset(key));
    expect(fetched.key).toBe(key);

    // On disk, the binary envelope is serialized through the json serializer —
    // the filename keeps the real asset extension plus the serializer suffix.
    await fs.access(path.join(tmpDir, 'uploads/pic.png.json'));
  });

  it('listResources reports the asset id as uploads/pic.png, not uploads/pic', async () => {
    const key = 'uploads/pic.png';
    await LaikaTask.runPromise(repo.createAsset({ key, content: PNG, mimeType: 'image/png' }));

    const { data } = await LaikaStream.runPromiseCollect(
      repo.listResources('uploads', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    expect(data.map(r => r.key)).toContain(key);
    expect(data.map(r => r.key)).not.toContain('uploads/pic');
  });

  it('a nested key with an unregistered extension (jpg) round-trips unchanged', async () => {
    const key = 'uploads/nested/photo.jpg';
    await LaikaTask.runPromise(repo.createAsset({ key, content: PNG, mimeType: 'image/jpeg' }));

    const fetched = await LaikaTask.runPromise(repo.getAsset(key));
    expect(fetched.key).toBe(key);
  });
});

// Regression coverage for LCMS-271: uploads/photo.jpg and uploads/photo.png must
// not collide on disk (they used to round-trip to the same `photo.json` sidecar),
// GET must echo the id/asset-url back with the original extension, and a listed
// asset must report its real contentType instead of null.
describe('CatalogAssetsRepository — LCMS-271 extension-collision regression', () => {
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it('uploading photo.jpg then photo.png yields two distinct assets, neither overwritten', async () => {
    const jpgKey = 'uploads/photo.jpg';
    const pngKey = 'uploads/photo.png';

    await LaikaTask.runPromise(repo.createAsset({ key: jpgKey, content: JPG, mimeType: 'image/jpeg' }));
    await LaikaTask.runPromise(repo.createAsset({ key: pngKey, content: PNG, mimeType: 'image/png' }));

    const jpgAsset = await LaikaTask.runPromise(repo.getAsset(jpgKey));
    const pngAsset = await LaikaTask.runPromise(repo.getAsset(pngKey));
    expect(jpgAsset.content.size).toBe(JPG.length);
    expect(pngAsset.content.size).toBe(PNG.length);
    expect(jpgAsset.content.contentType).toBe('image/jpeg');
    expect(pngAsset.content.contentType).toBe('image/png');

    // Distinct physical sidecars on disk — no overwrite.
    await fs.access(path.join(tmpDir, 'uploads/photo.jpg.json'));
    await fs.access(path.join(tmpDir, 'uploads/photo.png.json'));

    const { data, done } = await LaikaStream.runPromiseCollect(
      repo.listResources('uploads', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    expect(done.total).toBe(2);
    const keys = data.map(r => r.key);
    expect(keys).toContain(jpgKey);
    expect(keys).toContain(pngKey);
  });

  it('GET getResource (single) returns the id with the original extension', async () => {
    const key = 'uploads/moby-usim.jpg';
    await LaikaTask.runPromise(repo.createAsset({ key, content: JPG, mimeType: 'image/jpeg' }));

    const [resource] = await LaikaTask.runPromise(repo.getResource(key));
    expect(resource?.key).toBe(key);
  });

  it('getUrls (include=urls) returns the asset-url with the original extension', async () => {
    const key = 'uploads/moby-usim.jpg';
    const asset = await LaikaTask.runPromise(repo.createAsset({ key, content: JPG, mimeType: 'image/jpeg' }));

    const { data } = await LaikaStream.runPromiseCollect(repo.getUrls([asset]));
    expect(data[0]?.key).toBe(key);
    expect(data[0]?.url).toBe(key);
  });

  it('listResources reports the real contentType per asset, not null', async () => {
    const jpgKey = 'uploads/photo.jpg';
    const pngKey = 'uploads/photo.png';
    await LaikaTask.runPromise(repo.createAsset({ key: jpgKey, content: JPG, mimeType: 'image/jpeg' }));
    await LaikaTask.runPromise(repo.createAsset({ key: pngKey, content: PNG, mimeType: 'image/png' }));

    const { data } = await LaikaStream.runPromiseCollect(
      repo.listResources('uploads', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = new Map(data.map(r => [r.key, r]));
    const jpgResource = byKey.get(jpgKey);
    const pngResource = byKey.get(pngKey);
    expect(jpgResource?.type).toBe('asset');
    expect(pngResource?.type).toBe('asset');
    if (jpgResource?.type === 'asset') expect(jpgResource.content.contentType).toBe('image/jpeg');
    if (pngResource?.type === 'asset') expect(pngResource.content.contentType).toBe('image/png');
  });
});
