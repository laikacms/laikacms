import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { type StorageContractCase, storageContractRegistry } from '../../domain/storage/testing/index.js';
import { jsonSerializer } from '../../serializers/storage-serializers-json/index.js';

import { FileSystemStorageRepository } from './infrastructure/repositories/filesystem-repository.js';

const tmpDirs: string[] = [];

export const fileSystemStorageContractCase: StorageContractCase = {
  name: 'FileSystemStorageRepository',
  makeRepo: async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-fs-storage-contract-'));
    tmpDirs.push(root);
    return new FileSystemStorageRepository(root, { json: jsonSerializer }, 'json');
  },
  teardown: async () => {
    await Promise.all(
      tmpDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })),
    );
  },
};

storageContractRegistry.push(fileSystemStorageContractCase);
