import * as fs from 'fs/promises';
import { LaikaStream, LaikaTask } from 'laikacms/core';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { jsonSerializer } from '../../serializers/storage-serializers-json/index.js';
import { TestSettingsProvider } from '../documents-contentbase/testing.js';
import { FileSystemStorageRepository } from '../storage-fs/infrastructure/repositories/filesystem-repository.js';
import { ContentBaseAssetsRepository } from './assets-repository.js';

// Regression coverage for LCMS-540: FileSystemDataSource.stripExtension used to
// truncate at ANY dot, so an asset key like `uploads/pic.png` round-tripped as
// `uploads/pic` once it passed through the real storage-fs datasource. The
// existing assets-repository.test.ts suite only exercises InMemoryStorageRepository,
// which never truncates anything, so it never caught this. These tests wire the
// real FileSystemStorageRepository (with only a `json` serializer registered,
// matching the documented FS + ContentBase media setup) to prove the asset
// extension survives create/get/list.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let tmpDir: string;
let repo: ContentBaseAssetsRepository;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-assets-fs-test-'));
  const storage = new FileSystemStorageRepository(tmpDir, { json: jsonSerializer }, 'json');
  repo = new ContentBaseAssetsRepository(storage, new TestSettingsProvider());
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ContentBaseAssetsRepository over real FileSystemStorageRepository (LCMS-540)', () => {
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
