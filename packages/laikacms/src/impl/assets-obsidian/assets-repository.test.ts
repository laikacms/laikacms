import { BadRequestError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ObsidianAssetsRepository } from './assets-repository.js';

let vaultDir: string;

beforeEach(async () => {
  vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-obsidian-assets-test-'));
});

afterEach(async () => {
  await fs.rm(vaultDir, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('ObsidianAssetsRepository — assets', () => {
  it('createAsset writes a file and getAsset reads its metadata back', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir);
    const created = await LaikaTask.runPromise(repo.createAsset({
      key: 'attachments/logo.png',
      content: PNG,
      mimeType: 'image/png',
    }));

    expect(created.type).toBe('asset');
    expect(created.content.size).toBe(PNG.length);

    const fetched = await LaikaTask.runPromise(repo.getAsset('attachments/logo.png'));
    expect(fetched.content.mimeType).toBe('image/png');
    expect(fetched.content.extension).toBe('png');
    expect(fetched.content.filename).toBe('logo.png');

    // The bytes really landed in the vault.
    const onDisk = await fs.readFile(path.join(vaultDir, 'attachments/logo.png'));
    expect(new Uint8Array(onDisk)).toEqual(PNG);
  });

  it('getAssetContent streams the original bytes', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir);
    await LaikaTask.runPromise(repo.createAsset({
      key: 'pic.png',
      content: PNG,
      mimeType: 'image/png',
    }));

    const result = await repo.getAssetContent('pic.png');
    expect(result._tag).toBe('Success');
    if (result._tag !== 'Success') return;

    expect(result.success.contentType).toBe('image/png');
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.success.body) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(PNG));
  });

  it('rejects markdown notes — those belong to the documents layer', async () => {
    await fs.writeFile(path.join(vaultDir, 'note.md'), '# a note');
    const repo = new ObsidianAssetsRepository(vaultDir);

    const result = await LaikaTask.runPromiseResult(repo.getAsset('note.md'));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(BadRequestError);
  });

  it('updateAsset is unsupported on a metadata-less vault', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir);
    const result = await LaikaTask.runPromiseResult(
      repo.updateAsset({ key: 'pic.png', cacheControl: 'max-age=60' }),
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(BadRequestError);
  });

  it('deleteAsset removes the file', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir);
    await LaikaTask.runPromise(repo.createAsset({
      key: 'pic.png',
      content: PNG,
      mimeType: 'image/png',
    }));
    await LaikaTask.runPromise(repo.deleteAsset('pic.png'));

    const result = await LaikaTask.runPromiseResult(repo.getAsset('pic.png'));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(NotFoundError);
  });

  it('refuses keys that escape the vault root', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir);
    const result = await LaikaTask.runPromiseResult(repo.getAsset('../escape.png'));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(BadRequestError);
  });
});

describe('ObsidianAssetsRepository — listing', () => {
  it('done.total equals the full count, not the page count', async () => {
    await fs.mkdir(path.join(vaultDir, 'imgs'), { recursive: true });
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(path.join(vaultDir, `imgs/img${i}.png`), Buffer.from(PNG));
    }

    const repo = new ObsidianAssetsRepository(vaultDir);
    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('', { depth: 2, pagination: { offset: 0, limit: 2 } }),
    );

    // 5 images + 1 folder entry = 6 total; only 2 returned on the page
    expect(collected.data).toHaveLength(2);
    expect(collected.done.total).toBe(6);
  });

  it('listResources returns assets and folders, skipping notes and .obsidian', async () => {
    await fs.mkdir(path.join(vaultDir, 'attachments'), { recursive: true });
    await fs.mkdir(path.join(vaultDir, '.obsidian'), { recursive: true });
    await fs.writeFile(path.join(vaultDir, 'attachments/a.png'), Buffer.from(PNG));
    await fs.writeFile(path.join(vaultDir, 'note.md'), '# note');
    await fs.writeFile(path.join(vaultDir, '.obsidian/app.json'), '{}');

    const repo = new ObsidianAssetsRepository(vaultDir);
    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('', { depth: 3, pagination: { offset: 0, limit: 100 } }),
    );

    const keys = collected.data.map(r => r.key).sort();
    expect(keys).toEqual(['attachments', 'attachments/a.png']);
    const asset = collected.data.find(r => r.type === 'asset');
    expect(asset?.key).toBe('attachments/a.png');
  });

  it('listResources surfaces an unreadable subdirectory as a recoverableError + still returns siblings', async () => {
    await fs.mkdir(path.join(vaultDir, 'good'), { recursive: true });
    await fs.mkdir(path.join(vaultDir, 'forbidden'), { recursive: true });
    await fs.writeFile(path.join(vaultDir, 'good/a.png'), Buffer.from(PNG));
    await fs.writeFile(path.join(vaultDir, 'forbidden/secret.png'), Buffer.from(PNG));
    await fs.chmod(path.join(vaultDir, 'forbidden'), 0o000);

    try {
      const repo = new ObsidianAssetsRepository(vaultDir);
      const collected = await LaikaStream.runPromiseCollect(
        repo.listResources('', { depth: 3, pagination: { offset: 0, limit: 100 } }),
      );

      const keys = collected.data.map(r => r.key).sort();
      // 'good' and its child are visible; 'forbidden' is listed as a folder but
      // its contents could not be enumerated.
      expect(keys).toContain('good');
      expect(keys).toContain('good/a.png');
      expect(keys).toContain('forbidden');
      expect(keys).not.toContain('forbidden/secret.png');
      expect(collected.recoverableErrors.length).toBeGreaterThan(0);
    } finally {
      await fs.chmod(path.join(vaultDir, 'forbidden'), 0o700);
    }
  });

  it('filter[search] returns only keys that contain the substring, case-insensitively', async () => {
    await fs.writeFile(path.join(vaultDir, 'Banner.PNG'), Buffer.from(PNG));
    await fs.writeFile(path.join(vaultDir, 'icon.svg'), Buffer.from(PNG));

    const repo = new ObsidianAssetsRepository(vaultDir);
    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('', {
        depth: 1,
        pagination: { offset: 0, limit: 100 },
        filters: { search: 'banner' },
      }),
    );

    const keys = collected.data.map(r => r.key);
    expect(keys).toContain('Banner.PNG');
    expect(keys).not.toContain('icon.svg');
  });

  it('listResources returns all resources when no search filter is given', async () => {
    await fs.writeFile(path.join(vaultDir, 'a.png'), Buffer.from(PNG));
    await fs.writeFile(path.join(vaultDir, 'b.png'), Buffer.from(PNG));

    const repo = new ObsidianAssetsRepository(vaultDir);
    const collected = await LaikaStream.runPromiseCollect(
      repo.listResources('', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );

    const keys = collected.data.map(r => r.key);
    expect(keys).toContain('a.png');
    expect(keys).toContain('b.png');
  });
});

describe('ObsidianAssetsRepository — getVariations', () => {
  it('invokes createVariations callback and surfaces result on the returned entry', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir, {
      createVariations: key => ({ thumb: { variant: 'thumb', url: 'thumb-' + key } }),
    });
    await LaikaTask.runPromise(repo.createAsset({ key: 'pic.png', content: PNG, mimeType: 'image/png' }));
    const asset = await LaikaTask.runPromise(repo.getAsset('pic.png'));

    const { data } = await LaikaStream.runPromiseCollect(repo.getVariations([asset]));
    expect(data).toHaveLength(1);
    expect(data[0]?.key).toBe('pic.png');
    expect(data[0]?.variations['thumb']).toEqual({ variant: 'thumb', url: 'thumb-pic.png' });
  });

  it('returns empty variations when no createVariations option is set', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir);
    await LaikaTask.runPromise(repo.createAsset({ key: 'pic.png', content: PNG, mimeType: 'image/png' }));
    const asset = await LaikaTask.runPromise(repo.getAsset('pic.png'));

    const { data } = await LaikaStream.runPromiseCollect(repo.getVariations([asset]));
    expect(data).toHaveLength(1);
    expect(data[0]?.variations).toEqual({});
  });
});

describe('ObsidianAssetsRepository — urls & metadata', () => {
  it('getUrls applies the configured createUrl', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir, {
      createUrl: key => `https://cdn.example.com/${key}`,
    });
    await LaikaTask.runPromise(repo.createAsset({
      key: 'pic.png',
      content: PNG,
      mimeType: 'image/png',
    }));
    const asset = await LaikaTask.runPromise(repo.getAsset('pic.png'));

    const urls = await LaikaStream.runPromiseCollect(repo.getUrls([asset]));
    expect(urls.data[0]?.url).toBe('https://cdn.example.com/pic.png');
  });

  it('getMetadata reports a binary kind with size and mime type', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir);
    await LaikaTask.runPromise(repo.createAsset({
      key: 'pic.png',
      content: PNG,
      mimeType: 'image/png',
    }));
    const asset = await LaikaTask.runPromise(repo.getAsset('pic.png'));

    const metadata = await LaikaStream.runPromiseCollect(repo.getMetadata([asset]));
    expect(metadata.data[0]?.metadata.kind).toBe('binary');
    expect(metadata.data[0]?.metadata.size).toBe(PNG.length);
    expect(metadata.data[0]?.metadata.mimeType).toBe('image/png');
  });
});

describe('ObsidianAssetsRepository — getCapabilities', () => {
  it('returns a compatibilityDate string and a pagination object', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir);
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(typeof caps.compatibilityDate).toBe('string');
    expect(caps.compatibilityDate.length).toBeGreaterThan(0);
    expect(caps.pagination).toBeDefined();
    expect(caps.pagination.supported).toBe(true);
  });

  it('advertises a search filter in filtering.filters', async () => {
    const repo = new ObsidianAssetsRepository(vaultDir);
    const caps = await LaikaTask.runPromise(repo.getCapabilities());
    expect(caps.filtering).toBeDefined();
    expect(caps.filtering.supported).toBe(true);
    const filterNames = caps.filtering!.filters.map(f => f.name);
    expect(filterNames).toContain('search');
  });
});
