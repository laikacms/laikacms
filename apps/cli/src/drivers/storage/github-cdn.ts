import { GithubCdnStorageRepository } from 'laikacms/storage-github-cdn';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface GithubCdnOptions {
  readonly owner: string;
  readonly repo: string;
  readonly branch?: string;
  readonly fetchMeta?: boolean;
  readonly cdnBaseUrl?: string;
  readonly dataApiBaseUrl?: string;
  readonly userAgent?: string;
}

const readOptions = (raw: Record<string, unknown>): GithubCdnOptions => {
  const owner = raw.owner;
  const repo = raw.repo;
  if (typeof owner !== 'string' || !owner) throw new Error('github-cdn driver: "owner" is required');
  if (typeof repo !== 'string' || !repo) throw new Error('github-cdn driver: "repo" is required');
  return {
    owner,
    repo,
    branch: typeof raw.branch === 'string' ? raw.branch : undefined,
    fetchMeta: typeof raw.fetchMeta === 'boolean' ? raw.fetchMeta : undefined,
    cdnBaseUrl: typeof raw.cdnBaseUrl === 'string' ? raw.cdnBaseUrl : undefined,
    dataApiBaseUrl: typeof raw.dataApiBaseUrl === 'string' ? raw.dataApiBaseUrl : undefined,
    userAgent: typeof raw.userAgent === 'string' ? raw.userAgent : undefined,
  };
};

/**
 * Read-only backend over a **public** GitHub repository served through jsDelivr's
 * CDN — no credentials, no `@octokit/*`. Ideal as a migration *source* (writes
 * reject). Ships in `laikacms`, so it never triggers an install prompt.
 */
export const githubCdnDriver: StorageDriver = {
  name: 'github-cdn',
  packageName: 'laikacms',
  version: '*',
  subpath: 'storage-github-cdn',
  description: 'Public GitHub repo over jsDelivr CDN (read-only, no credentials)',
  build(raw) {
    return new GithubCdnStorageRepository({
      ...readOptions(raw),
      serializerRegistry: defaultSerializerRegistry,
    });
  },
};
