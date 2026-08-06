import { WebDavStorageRepository } from 'laikacms/storage-webdav';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface WebdavOptions {
  readonly baseUrl: string;
  readonly basePath?: string;
  readonly defaultExtension: string;
  readonly username?: string;
  readonly password?: string;
  readonly token?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

const readOptions = (raw: Record<string, unknown>): WebdavOptions => {
  const baseUrl = raw.baseUrl;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('webdav driver: "baseUrl" is required');
  }
  const headers = raw.headers && typeof raw.headers === 'object'
    ? (raw.headers as Record<string, string>)
    : undefined;
  return {
    baseUrl,
    basePath: typeof raw.basePath === 'string' ? raw.basePath : undefined,
    defaultExtension: typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md',
    username: typeof raw.username === 'string' ? raw.username : undefined,
    password: typeof raw.password === 'string' ? raw.password : undefined,
    token: typeof raw.token === 'string' ? raw.token : undefined,
    headers,
  };
};

export const webdavDriver: StorageDriver = {
  name: 'webdav',
  packageName: 'laikacms',
  version: '*',
  subpath: 'storage-webdav',
  description: 'WebDAV server (Nextcloud, ownCloud, mod_dav, rclone serve)',
  build(raw) {
    const options = readOptions(raw);
    const auth = (options.username || options.password || options.token || options.headers)
      ? {
        username: options.username,
        password: options.password,
        token: options.token,
        headers: options.headers,
      }
      : undefined;
    return new WebDavStorageRepository(
      { baseUrl: options.baseUrl, basePath: options.basePath, auth },
      defaultSerializerRegistry,
      options.defaultExtension,
    );
  },
};
