import type { StorageRepository } from 'laikacms/storage';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface GitlabAuth {
  readonly token?: string;
  readonly oauthToken?: string;
  readonly jobToken?: string;
}

interface GitlabOptions {
  readonly projectId: string | number;
  readonly branch: string;
  readonly auth?: GitlabAuth;
  readonly apiUrl?: string;
  readonly defaultFileExtension: string;
  readonly commitAuthor?: { name: string, email: string };
}

const readOptions = (raw: Record<string, unknown>): GitlabOptions => {
  const projectId = raw.projectId;
  const branch = raw.branch;
  if (typeof projectId !== 'string' && typeof projectId !== 'number') {
    throw new Error('gitlab driver: "projectId" (numeric id or url-encoded path) is required');
  }
  if (typeof branch !== 'string' || !branch) throw new Error('gitlab driver: "branch" is required');

  // Prefer explicit options, fall back to the conventional GitLab env vars.
  const token = typeof raw.token === 'string' ? raw.token : process.env.GITLAB_TOKEN;
  const oauthToken = typeof raw.oauthToken === 'string' ? raw.oauthToken : undefined;
  const jobToken = typeof raw.jobToken === 'string' ? raw.jobToken : process.env.CI_JOB_TOKEN;
  const auth = (token || oauthToken || jobToken) ? { token, oauthToken, jobToken } : undefined;

  const commitAuthor = raw.commitAuthor && typeof raw.commitAuthor === 'object'
    ? (raw.commitAuthor as { name: string, email: string })
    : undefined;

  return {
    projectId,
    branch,
    auth,
    apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl : undefined,
    defaultFileExtension: typeof raw.defaultFileExtension === 'string'
      ? raw.defaultFileExtension
      : (typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md'),
    commitAuthor,
  };
};

export const gitlabDriver: StorageDriver = {
  name: 'gitlab',
  packageName: '@laikacms/gitlab',
  version: '1.0.2',
  subpath: 'storage-gl',
  description: 'GitLab project (commits per write, via PAT/OAuth/CI job token)',
  build(raw, mod) {
    const options = readOptions(raw);
    const Ctor = mod.GitlabStorageRepository as new(
      o: GitlabOptions & { serializerRegistry: typeof defaultSerializerRegistry },
    ) => StorageRepository;
    return new Ctor({ ...options, serializerRegistry: defaultSerializerRegistry });
  },
};
