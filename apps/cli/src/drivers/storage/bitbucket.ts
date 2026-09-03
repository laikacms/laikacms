import type { StorageRepository } from 'laikacms/storage';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface BitbucketAuth {
  readonly appPassword?: { username: string, password: string };
  readonly oauthToken?: string;
}

interface BitbucketOptions {
  readonly workspace: string;
  readonly repo: string;
  readonly branch: string;
  readonly auth: BitbucketAuth;
  readonly apiUrl?: string;
  readonly defaultFileExtension: string;
  readonly commitAuthor?: { name: string, email: string };
}

const readOptions = (raw: Record<string, unknown>): BitbucketOptions => {
  const workspace = raw.workspace;
  const repo = raw.repo;
  const branch = raw.branch;
  if (typeof workspace !== 'string' || !workspace) {
    throw new Error('bitbucket driver: "workspace" is required');
  }
  if (typeof repo !== 'string' || !repo) throw new Error('bitbucket driver: "repo" is required');
  if (typeof branch !== 'string' || !branch) throw new Error('bitbucket driver: "branch" is required');

  // App-password (username + password) or an OAuth2 bearer token. Env fallbacks
  // mirror Bitbucket's conventional names.
  const oauthToken = typeof raw.oauthToken === 'string' ? raw.oauthToken : process.env.BITBUCKET_TOKEN;
  const username = typeof raw.username === 'string' ? raw.username : process.env.BITBUCKET_USERNAME;
  const password = typeof raw.password === 'string' ? raw.password : process.env.BITBUCKET_APP_PASSWORD;
  let auth: BitbucketAuth;
  if (oauthToken) {
    auth = { oauthToken };
  } else if (username && password) {
    auth = { appPassword: { username, password } };
  } else {
    throw new Error(
      'bitbucket driver: provide "oauthToken" (or BITBUCKET_TOKEN), or "username" + "password" '
        + '(app password; or BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD)',
    );
  }

  const commitAuthor = raw.commitAuthor && typeof raw.commitAuthor === 'object'
    ? (raw.commitAuthor as { name: string, email: string })
    : undefined;

  return {
    workspace,
    repo,
    branch,
    auth,
    apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl : undefined,
    defaultFileExtension: typeof raw.defaultFileExtension === 'string'
      ? raw.defaultFileExtension
      : (typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md'),
    commitAuthor,
  };
};

export const bitbucketDriver: StorageDriver = {
  name: 'bitbucket',
  packageName: '@laikacms/bitbucket',
  version: '2.0.0',
  subpath: 'storage-bb',
  description: 'Bitbucket Cloud repository (commits per write, via app password/OAuth2)',
  build(raw, mod) {
    const options = readOptions(raw);
    const Ctor = mod.BitbucketStorageRepository as new(
      o: BitbucketOptions & { serializerRegistry: typeof defaultSerializerRegistry },
    ) => StorageRepository;
    return new Ctor({ ...options, serializerRegistry: defaultSerializerRegistry });
  },
};
