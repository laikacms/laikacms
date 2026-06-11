import { StorageJsonApiProxyRepository } from 'laikacms/storage-jsonapi-proxy';

import type { StorageDriver } from '../types.js';

interface ProxyOptions {
  readonly baseUrl: string;
  readonly authToken?: string;
}

const readOptions = (raw: Record<string, unknown>): ProxyOptions => {
  const baseUrl = raw.baseUrl;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('jsonapi-proxy driver: "baseUrl" is required');
  }
  return {
    baseUrl,
    authToken: typeof raw.authToken === 'string' ? raw.authToken : undefined,
  };
};

export const jsonApiProxyDriver: StorageDriver = {
  name: 'jsonapi-proxy',
  packageName: 'laikacms',
  version: '*',
  subpath: 'storage-jsonapi-proxy',
  description: 'Proxy to a remote storage-api JSON:API endpoint',
  build(raw) {
    return new StorageJsonApiProxyRepository(readOptions(raw));
  },
};
