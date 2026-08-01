import { LaikaTask, TooManyRequestsError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { describe, expect, it } from 'vitest';

import { GithubStorageRepository } from './github-storage-repository.js';
import { githubContractCase } from './testing/index.js';

runStorageRepositoryContract(githubContractCase);

describe('GithubStorageRepository mapError', () => {
  it('maps a 429 response to TooManyRequestsError', async () => {
    const notFoundError = Object.assign(new Error('Not Found'), { status: 404 });
    const rateLimitError = Object.assign(new Error('secondary rate limit exceeded'), { status: 429 });
    const mockOctokit = {
      repos: {
        // resolvePathWithExtension probes via getContent (getFileMeta) → 404 → null (no existing file)
        getContent: async () => {
          throw notFoundError;
        },
        // createObject calls createOrUpdate → 429 → TooManyRequestsError propagates via liftResult
        createOrUpdateFileContents: async () => {
          throw rateLimitError;
        },
        deleteFile: async () => {
          throw notFoundError;
        },
      },
      rest: { repos: { listCommits: async () => ({ data: [], headers: {} }) } },
    };

    const repo = new GithubStorageRepository({
      appId: '1',
      privateKey:
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4bzVoHpIgVHqKsYbkqNdkW0zKMC\n-----END RSA PRIVATE KEY-----',
      installationId: '1',
      owner: 'test-owner',
      repo: 'test-repo',
      branch: 'main',
      octokit: mockOctokit as never,
      serializerRegistry: {
        json: {
          format: { mediaType: 'application/json' } as never,
          serializeDocumentFileContents: async (c: unknown) => JSON.stringify(c),
          deserializeDocumentFileContents: async (r: string) => JSON.parse(r) as Record<string, unknown>,
        },
      },
      defaultFileExtension: 'json',
    });

    await expect(
      LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'some-key', content: { body: 'hi' } })),
    ).rejects.toBeInstanceOf(TooManyRequestsError);
  });
});
