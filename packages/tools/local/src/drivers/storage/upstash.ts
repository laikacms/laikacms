import type { StorageRepository } from 'laikacms/storage';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface UpstashOptions {
  readonly url: string;
  readonly token: string;
  readonly namespace?: string;
  readonly defaultExtension: string;
}

const readOptions = (raw: Record<string, unknown>): UpstashOptions => {
  const url = typeof raw.url === 'string' ? raw.url : process.env.UPSTASH_REDIS_REST_URL;
  const token = typeof raw.token === 'string' ? raw.token : process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url) {
    throw new Error(
      'upstash driver: "url" is required (or set UPSTASH_REDIS_REST_URL in the environment)',
    );
  }
  if (!token) {
    throw new Error(
      'upstash driver: "token" is required (or set UPSTASH_REDIS_REST_TOKEN in the environment)',
    );
  }
  return {
    url,
    token,
    namespace: typeof raw.namespace === 'string' ? raw.namespace : undefined,
    defaultExtension: typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md',
  };
};

export const upstashDriver: StorageDriver = {
  name: 'upstash',
  packageName: '@laikacms/upstash',
  version: '1.0.0',
  subpath: 'storage-redis',
  description: 'Upstash Redis (REST) — namespaced KV with TTL',
  build(raw, mod) {
    const options = readOptions(raw);
    const Ctor = mod.UpstashRedisStorageRepository as new(o: {
      url: string,
      token: string,
      namespace?: string,
      serializerRegistry: typeof defaultSerializerRegistry,
      defaultFileExtension: string,
    }) => StorageRepository;
    return new Ctor({
      url: options.url,
      token: options.token,
      namespace: options.namespace,
      serializerRegistry: defaultSerializerRegistry,
      defaultFileExtension: options.defaultExtension,
    });
  },
};
