import type { StorageRepository } from 'laikacms/storage';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface VercelOptions {
  readonly token: string;
  readonly basePath?: string;
  readonly defaultExtension: string;
  readonly apiUrl?: string;
}

const readOptions = (raw: Record<string, unknown>): VercelOptions => {
  const token = typeof raw.token === 'string' ? raw.token : process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      'vercel driver: "token" is required (or set BLOB_READ_WRITE_TOKEN in the environment)',
    );
  }
  return {
    token,
    basePath: typeof raw.basePath === 'string' ? raw.basePath : undefined,
    defaultExtension: typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md',
    apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl : undefined,
  };
};

export const vercelDriver: StorageDriver = {
  name: 'vercel',
  packageName: '@laikacms/vercel',
  version: '1.0.0',
  subpath: 'storage-blob',
  description: 'Vercel Blob — path-flat blob storage on the edge',
  build(raw, mod) {
    const options = readOptions(raw);
    const DataSourceCtor = mod.VercelBlobDataSource as new(
      o: { auth: { token: string }, apiUrl?: string },
    ) => unknown;
    const dataSource = new DataSourceCtor({
      auth: { token: options.token },
      apiUrl: options.apiUrl,
    });
    const Ctor = mod.VercelBlobStorageRepository as new(
      o: {
        dataSource: unknown,
        basePath?: string,
        serializerRegistry: typeof defaultSerializerRegistry,
        defaultFileExtension: string,
      },
    ) => StorageRepository;
    return new Ctor({
      dataSource,
      basePath: options.basePath,
      serializerRegistry: defaultSerializerRegistry,
      defaultFileExtension: options.defaultExtension,
    });
  },
};
