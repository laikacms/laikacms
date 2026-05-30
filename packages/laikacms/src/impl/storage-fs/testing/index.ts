// Testkit for FileSystemStorageRepository.
// Uses a real FileSystemStorageRepository + a real OS tmp directory as the backend.
// The tmp directory is created fresh on each makeRepo() call; it is ephemeral
// and does not require explicit teardown.
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { StorageFormat, StorageObjectContent, StorageSerializer } from 'laikacms/storage';

import type { StorageContractCase } from '../../../domain/storage/testing/contract.js';
import { FileSystemStorageRepository } from '../infrastructure/repositories/filesystem-repository.js';

const jsonSerializer: StorageSerializer<StorageFormat> = {
  format: 'json' as StorageFormat,
  async serializeDocumentFileContents(content: StorageObjectContent): Promise<string> {
    return JSON.stringify(content);
  },
  async deserializeDocumentFileContents(raw: string): Promise<StorageObjectContent> {
    return JSON.parse(raw) as StorageObjectContent;
  },
};

export const storagefsContractCase: StorageContractCase = {
  name: 'FileSystemStorageRepository',
  async makeRepo(): Promise<FileSystemStorageRepository> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-fs-contract-'));
    return new FileSystemStorageRepository(
      tmpDir,
      { json: jsonSerializer },
      'json',
    );
  },
};
