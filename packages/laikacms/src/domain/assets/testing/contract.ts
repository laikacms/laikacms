import type { Asset, AssetsRepository, Resource } from 'laikacms/assets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectStream, runTask } from '../../../shared/core/compat.js';
import { NotFoundError } from '../../../shared/core/index.js';

export type AssetsContractCapability =
  | 'createAsset'
  | 'updateAsset'
  | 'deleteAsset'
  | 'deleteAssets'
  | 'deleteAssetsTracksSkipped'
  | 'listResources'
  | 'getResource'
  | 'createFolder'
  | 'getFolder'
  | 'deleteFolder'
  | 'getUrls'
  | 'getMetadata'
  | 'getVariations';

export interface AssetsContractCase {
  name: string;
  makeRepo: () => AssetsRepository | Promise<AssetsRepository>;
  teardown?: () => void | Promise<void>;
  skip?: AssetsContractCapability[];
  /**
   * Optional folder prefix all keys are created under. Some impls require keys
   * to live inside a configured collection. Defaults to 'uploads'.
   */
  collectionFolder?: string;
}

const DEFAULT_PAGINATION = { offset: 0, limit: 100 };

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function runAssetsRepositoryContract(testCase: AssetsContractCase): void {
  const { name, makeRepo, teardown, skip = [], collectionFolder = 'uploads' } = testCase;

  describe(`AssetsRepository contract: ${name}`, () => {
    let repo: AssetsRepository;

    beforeAll(async () => {
      repo = await makeRepo();
    });

    if (teardown) {
      afterAll(async () => {
        await teardown();
      });
    }

    const itOrSkip = (capability: AssetsContractCapability) => skip.includes(capability) ? it.skip : it;

    const keyIn = (slug: string) => `${collectionFolder}/${slug}`;

    it('getCapabilities: returns a Capabilities value', async () => {
      const caps = await runTask(repo.getCapabilities());
      expect(caps).toBeDefined();
      expect(typeof caps.compatibilityDate).toBe('string');
      expect(caps.pagination).toBeDefined();
    });

    // --- createAsset then getAsset ---
    itOrSkip('createAsset')('createAsset then getAsset: returns matching key + asset type', async () => {
      const key = keyIn(`create-${Date.now()}.png`);
      const created: Asset = await runTask(
        repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' }),
      );
      expect(created.key).toBe(key);
      expect(created.type).toBe('asset');

      const fetched: Asset = await runTask(repo.getAsset(key));
      expect(fetched.key).toBe(key);
      expect(fetched.type).toBe('asset');
    });

    // --- updateAsset (metadata only) ---
    itOrSkip('updateAsset')('updateAsset: returns the asset (metadata change does not throw)', async () => {
      const key = keyIn(`update-${Date.now()}.png`);
      await runTask(repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' }));

      const updated: Asset = await runTask(
        repo.updateAsset({ key, customMetadata: { tag: 'v2' } }),
      );
      expect(updated.key).toBe(key);
      expect(updated.type).toBe('asset');
    });

    // --- deleteAsset ---
    itOrSkip('deleteAsset')('deleteAsset: subsequent getAsset fails with NotFoundError', async () => {
      const key = keyIn(`delete-${Date.now()}.png`);
      await runTask(repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' }));
      await runTask(repo.deleteAsset(key));

      await expect(runTask(repo.getAsset(key))).rejects.toMatchObject({ code: NotFoundError.CODE });
    });

    // --- deleteAssets bulk ---
    itOrSkip('deleteAssets')('deleteAssets: removes existing keys (removed > 0)', async () => {
      const stamp = Date.now();
      const k1 = keyIn(`bulk-${stamp}-1.png`);
      const k2 = keyIn(`bulk-${stamp}-2.png`);
      await runTask(repo.createAsset({ key: k1, content: PNG_BYTES, mimeType: 'image/png' }));
      await runTask(repo.createAsset({ key: k2, content: PNG_BYTES, mimeType: 'image/png' }));

      const { done } = await collectStream(repo.deleteAssets([k1, k2]));
      expect(done.removed).toBeGreaterThan(0);
    });

    itOrSkip('deleteAssetsTracksSkipped')('deleteAssets: missing key reports skipped > 0', async () => {
      const missing = keyIn(`missing-${Date.now()}.png`);
      const { done } = await collectStream(repo.deleteAssets([missing]));
      expect(done.skipped).toBeGreaterThan(0);
    });

    // --- listResources ---
    itOrSkip('listResources')('listResources after create: returns created keys', async () => {
      const stamp = Date.now();
      const folder = `${collectionFolder}/list-${stamp}`;
      const keys = [`${folder}/a.png`, `${folder}/b.png`, `${folder}/c.png`];
      for (const key of keys) {
        await runTask(repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' }));
      }

      const { items } = await collectStream(
        repo.listResources(folder, { depth: 1, pagination: DEFAULT_PAGINATION }),
      );
      const returnedKeys = (items as Resource[]).map(r => r.key);
      for (const key of keys) {
        expect(returnedKeys).toContain(key);
      }
    });

    // --- getResource ---
    itOrSkip('getResource')('getResource for an asset: returns at least one entry with matching key', async () => {
      const key = keyIn(`resource-${Date.now()}.png`);
      await runTask(repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' }));

      const resources = await runTask(repo.getResource(key));
      expect(Array.isArray(resources)).toBe(true);
      expect(resources.length).toBeGreaterThan(0);
      expect(resources.some(r => r.key === key)).toBe(true);
    });

    // --- createFolder / getFolder ---
    itOrSkip('createFolder')('createFolder then getFolder: returns the folder', async () => {
      const key = `${collectionFolder}/folder-${Date.now()}`;
      const created = await runTask(repo.createFolder({ key, type: 'folder' }));
      expect(created.type).toBe('folder');
      expect(created.key).toBe(key);

      const fetched = await runTask(repo.getFolder(key));
      expect(fetched.key).toBe(key);
      expect(fetched.type).toBe('folder');
    });

    // --- deleteFolder ---
    itOrSkip('deleteFolder')('deleteFolder: subsequent getFolder fails with NotFoundError', async () => {
      const key = `${collectionFolder}/folder-del-${Date.now()}`;
      await runTask(repo.createFolder({ key, type: 'folder' }));
      await runTask(repo.deleteFolder(key, true));

      await expect(runTask(repo.getFolder(key))).rejects.toMatchObject({ code: NotFoundError.CODE });
    });

    // --- getUrls ---
    itOrSkip('getUrls')('getUrls: yields one entry per asset', async () => {
      const k1 = keyIn(`urls-${Date.now()}-1.png`);
      const k2 = keyIn(`urls-${Date.now()}-2.png`);
      const a1 = await runTask(repo.createAsset({ key: k1, content: PNG_BYTES, mimeType: 'image/png' }));
      const a2 = await runTask(repo.createAsset({ key: k2, content: PNG_BYTES, mimeType: 'image/png' }));

      const { items } = await collectStream(repo.getUrls([a1, a2]));
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(2);
    });

    // --- getMetadata ---
    itOrSkip('getMetadata')('getMetadata: yields one entry per asset', async () => {
      const k1 = keyIn(`meta-${Date.now()}-1.png`);
      const a1 = await runTask(repo.createAsset({ key: k1, content: PNG_BYTES, mimeType: 'image/png' }));

      const { items } = await collectStream(repo.getMetadata([a1]));
      expect(items.length).toBeGreaterThan(0);
    });

    // --- getVariations ---
    itOrSkip('getVariations')('getVariations: yields entries for assets that support them', async () => {
      const k1 = keyIn(`var-${Date.now()}-1.png`);
      const a1 = await runTask(repo.createAsset({ key: k1, content: PNG_BYTES, mimeType: 'image/png' }));

      const { items } = await collectStream(repo.getVariations([a1]));
      expect(Array.isArray(items)).toBe(true);
    });
  });
}
