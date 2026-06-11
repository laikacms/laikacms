import fs from 'node:fs';

import type { StorageRepository } from 'laikacms/storage';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface GithubOptions {
  readonly appId: string | number;
  readonly privateKey: string;
  readonly installationId: string | number;
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly defaultExtension: string;
  readonly commitAuthor?: { name: string, email: string };
}

const readOptions = (raw: Record<string, unknown>): GithubOptions => {
  const appId = raw.appId ?? process.env.GITHUB_APP_ID;
  const installationId = raw.installationId ?? process.env.GITHUB_INSTALLATION_ID;
  const owner = raw.owner;
  const repo = raw.repo;
  const branch = raw.branch;
  if (typeof appId !== 'string' && typeof appId !== 'number') {
    throw new Error('github driver: "appId" is required');
  }
  if (typeof installationId !== 'string' && typeof installationId !== 'number') {
    throw new Error('github driver: "installationId" is required');
  }
  if (typeof owner !== 'string' || !owner) throw new Error('github driver: "owner" is required');
  if (typeof repo !== 'string' || !repo) throw new Error('github driver: "repo" is required');
  if (typeof branch !== 'string' || !branch) throw new Error('github driver: "branch" is required');

  // Accept the PEM literally OR via a path (`privateKeyPath`) — the latter is
  // friendlier for shell and JSON configs.
  let privateKey: string | undefined;
  if (typeof raw.privateKey === 'string' && raw.privateKey.length > 0) {
    privateKey = raw.privateKey;
  } else if (typeof raw.privateKeyPath === 'string' && raw.privateKeyPath.length > 0) {
    privateKey = fs.readFileSync(raw.privateKeyPath, 'utf8');
  } else if (process.env.GITHUB_APP_PRIVATE_KEY) {
    privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  }
  if (!privateKey) {
    throw new Error(
      'github driver: provide "privateKey" (PEM string), "privateKeyPath" (file path), '
        + 'or GITHUB_APP_PRIVATE_KEY in the environment',
    );
  }

  const commitAuthor = raw.commitAuthor && typeof raw.commitAuthor === 'object'
    ? (raw.commitAuthor as { name: string, email: string })
    : undefined;

  return {
    appId,
    privateKey,
    installationId,
    owner,
    repo,
    branch,
    defaultExtension: typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md',
    commitAuthor,
  };
};

export const githubDriver: StorageDriver = {
  name: 'github',
  packageName: '@laikacms/github',
  version: '1.0.0',
  subpath: 'storage-gh',
  description: 'GitHub repository (commits per write, via a GitHub App)',
  build(raw, mod) {
    const options = readOptions(raw);
    const Ctor = mod.GithubStorageRepository as new(
      o: GithubOptions & {
        serializerRegistry: typeof defaultSerializerRegistry,
      },
    ) => StorageRepository;
    return new Ctor({
      ...options,
      serializerRegistry: defaultSerializerRegistry,
    });
  },
};
