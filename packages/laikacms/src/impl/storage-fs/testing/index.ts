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

// `removeAtoms` on the FS backend deletes via the `trash` package. Under WSL,
// `trash` shells out to Windows PowerShell; inside vitest's worker pool the WSL
// path-conversion degrades so it spawns a `C:\…\powershell.exe` path the Linux
// side can't resolve (`spawn … ENOENT`). This is a WSL-dev-box-only quirk — on
// the real Linux CI runner (isWsl === false) `trash` uses its native Linux
// implementation and the full delete-path contract runs. Skip only under WSL.
const isWsl = process.platform === 'linux' && os.release().toLowerCase().includes('microsoft');

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
  skip: isWsl ? ['removeAtoms'] : [],
  async makeRepo(): Promise<FileSystemStorageRepository> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-fs-contract-'));
    return new FileSystemStorageRepository(
      tmpDir,
      { json: jsonSerializer },
      'json',
    );
  },
};
