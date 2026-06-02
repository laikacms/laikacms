import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { type DocumentsContractCase, documentsContractRegistry } from '../../domain/documents/testing/index.js';
import { markdownSerializer } from '../../serializers/storage-serializers-markdown/index.js';
import { FileSystemStorageRepository } from '../storage-fs/infrastructure/repositories/filesystem-repository.js';

import { ObsidianDocumentsRepository } from './documents-repository.js';

const tmpDirs: string[] = [];

export const obsidianDocumentsContractCase: DocumentsContractCase = {
  name: 'ObsidianDocumentsRepository (over an FS vault)',
  makeRepo: async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-obsidian-docs-contract-'));
    tmpDirs.push(root);
    const storage = new FileSystemStorageRepository(root, { md: markdownSerializer }, 'md');
    return new ObsidianDocumentsRepository(storage);
  },
  teardown: async () => {
    await Promise.all(
      tmpDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })),
    );
  },
  /**
   * Obsidian vaults have no version history and no separate revision directory,
   * so the revision-shaped capabilities are out of scope for this backend.
   */
  skip: ['createRevision', 'listRevisions'],
};

documentsContractRegistry.push(obsidianDocumentsContractCase);
