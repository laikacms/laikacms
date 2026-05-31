import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { type AssetsContractCase, assetsContractRegistry } from '../../domain/assets/testing/index.js';

import { ObsidianAssetsRepository } from './assets-repository.js';

const tmpDirs: string[] = [];

export const obsidianAssetsContractCase: AssetsContractCase = {
  name: 'ObsidianAssetsRepository (over a tmpdir vault)',
  makeRepo: async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-obsidian-assets-contract-'));
    tmpDirs.push(root);
    return new ObsidianAssetsRepository(root);
  },
  teardown: async () => {
    await Promise.all(
      tmpDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })),
    );
  },
  /**
   * Obsidian vaults have no place to keep per-file custom metadata or cache
   * headers — `updateAsset` is documented as unsupported (`BadRequestError`).
   */
  skip: ['updateAsset'],
};

assetsContractRegistry.push(obsidianAssetsContractCase);
