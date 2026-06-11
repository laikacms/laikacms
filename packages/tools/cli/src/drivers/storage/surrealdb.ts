import type { StorageRepository } from 'laikacms/storage';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface SurrealOptions {
  readonly url?: string;
  readonly namespace: string;
  readonly database: string;
  readonly token?: string;
  readonly username?: string;
  readonly password?: string;
  readonly fileTable?: string;
  readonly folderTable?: string;
  readonly defaultExtension: string;
}

const readOptions = (raw: Record<string, unknown>): SurrealOptions => {
  const namespace = raw.namespace;
  const database = raw.database;
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new Error('surrealdb driver: "namespace" is required');
  }
  if (typeof database !== 'string' || database.length === 0) {
    throw new Error('surrealdb driver: "database" is required');
  }
  return {
    url: typeof raw.url === 'string' ? raw.url : undefined,
    namespace,
    database,
    token: typeof raw.token === 'string' ? raw.token : undefined,
    username: typeof raw.username === 'string' ? raw.username : undefined,
    password: typeof raw.password === 'string' ? raw.password : undefined,
    fileTable: typeof raw.fileTable === 'string' ? raw.fileTable : undefined,
    folderTable: typeof raw.folderTable === 'string' ? raw.folderTable : undefined,
    defaultExtension: typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md',
  };
};

export const surrealDbDriver: StorageDriver = {
  name: 'surrealdb',
  packageName: '@laikacms/surrealdb',
  version: '1.0.0',
  subpath: 'storage-surrealdb',
  description: 'SurrealDB — multi-model database with SurQL',
  build(raw, mod) {
    const options = readOptions(raw);
    const auth = options.token
      ? { token: options.token }
      : options.username && options.password
      ? { basic: { username: options.username, password: options.password } }
      : undefined;
    const DataSourceCtor = mod.SurrealDbDataSource as new(o: {
      url?: string,
      namespace: string,
      database: string,
      auth?: typeof auth,
    }) => unknown;
    const dataSource = new DataSourceCtor({
      url: options.url,
      namespace: options.namespace,
      database: options.database,
      auth,
    });
    const Ctor = mod.SurrealDbStorageRepository as new(o: {
      dataSource: unknown,
      fileTable?: string,
      folderTable?: string,
      serializerRegistry: typeof defaultSerializerRegistry,
      defaultFileExtension: string,
    }) => StorageRepository;
    return new Ctor({
      dataSource,
      fileTable: options.fileTable,
      folderTable: options.folderTable,
      serializerRegistry: defaultSerializerRegistry,
      defaultFileExtension: options.defaultExtension,
    });
  },
};
