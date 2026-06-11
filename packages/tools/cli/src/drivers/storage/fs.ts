import fs from 'node:fs';
import path from 'node:path';

import { FileSystemStorageRepository } from 'laikacms/storage-fs';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface FsOptions {
  readonly root: string;
  readonly defaultExtension?: string;
}

const readOptions = (raw: Record<string, unknown>): FsOptions => {
  const root = raw.root;
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('fs driver: "root" (string, absolute path) is required');
  }
  return {
    root: path.resolve(root),
    defaultExtension: typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md',
  };
};

export const fsDriver: StorageDriver = {
  name: 'fs',
  packageName: 'laikacms',
  version: '*',
  subpath: 'storage-fs',
  description: 'Local filesystem (a directory of markdown/yaml/json files)',
  build(raw) {
    const options = readOptions(raw);
    // Best-effort mkdir so a fresh destination dir doesn't crash the first
    // write. Sync because driver builders are sync; the directory tree is
    // tiny so the call is negligible.
    fs.mkdirSync(options.root, { recursive: true });
    return new FileSystemStorageRepository(
      options.root,
      defaultSerializerRegistry,
      options.defaultExtension ?? 'md',
    );
  },
};
