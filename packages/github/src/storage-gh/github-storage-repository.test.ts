import {
  ForbiddenError,
  InternalError,
  LaikaTask,
  TooManyRequestsError,
  UpstreamUnAuthorizedError,
  VersionMismatchError,
} from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { describe, expect, it } from 'vitest';

import { GithubStorageRepository } from './github-storage-repository.js';
import { githubContractCase } from './testing/index.js';

const APP_AUTH_OPTIONS = {
  appId: '1',
  privateKey:
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4bzVoHpIgVHqKsYbkqNdkW0zKMC\n-----END RSA PRIVATE KEY-----',
  installationId: '1',
} as const;

const makeRepoWithGetContent = (getContent: () => Promise<never>) =>
  new GithubStorageRepository({
    ...APP_AUTH_OPTIONS,
    owner: 'test-owner',
    repo: 'test-repo',
    branch: 'main',
    octokit: {
      repos: { getContent },
      rest: { repos: { listCommits: async () => ({ data: [], headers: {} }) } },
    } as never,
    serializerRegistry: {
      json: {
        format: { mediaType: 'application/json' } as never,
        serializeDocumentFileContents: async (c: unknown) => JSON.stringify(c),
        deserializeDocumentFileContents: async (r: string) => JSON.parse(r) as Record<string, unknown>,
      },
    },
    defaultFileExtension: 'json',
  });

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
      ...APP_AUTH_OPTIONS,
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

describe('GithubStorageRepository.getAtom error propagation', () => {
  it('propagates TooManyRequestsError (429) instead of falling through to getObject', async () => {
    const rateLimitError = Object.assign(new Error('secondary rate limit exceeded'), { status: 429 });
    const repo = makeRepoWithGetContent(async () => {
      throw rateLimitError;
    });

    await expect(
      LaikaTask.runPromise(repo.getAtom('notes/article')),
    ).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('propagates ForbiddenError (403) instead of falling through to getObject', async () => {
    const forbiddenError = Object.assign(new Error('Resource not accessible by integration'), {
      status: 403,
      response: { headers: {} },
    });
    const repo = makeRepoWithGetContent(async () => {
      throw forbiddenError;
    });

    await expect(
      LaikaTask.runPromise(repo.getAtom('notes/article')),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('propagates UpstreamUnAuthorizedError (401) instead of falling through to getObject', async () => {
    const unauthorizedError = Object.assign(new Error('Bad credentials'), { status: 401 });
    const repo = makeRepoWithGetContent(async () => {
      throw unauthorizedError;
    });

    await expect(
      LaikaTask.runPromise(repo.getAtom('notes/article')),
    ).rejects.toBeInstanceOf(UpstreamUnAuthorizedError);
  });

  it('propagates TooManyRequestsError for a 403 with x-ratelimit-remaining: 0', async () => {
    const rateLimitedForbidden = Object.assign(new Error('API rate limit exceeded'), {
      status: 403,
      response: { headers: { 'x-ratelimit-remaining': '0' } },
    });
    const repo = makeRepoWithGetContent(async () => {
      throw rateLimitedForbidden;
    });

    await expect(
      LaikaTask.runPromise(repo.getAtom('notes/article')),
    ).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('propagates ForbiddenError for a generic 403 (no rate-limit header, no "Resource not accessible" message)', async () => {
    const genericForbidden = Object.assign(new Error('Forbidden'), {
      status: 403,
      response: { headers: {} },
    });
    const repo = makeRepoWithGetContent(async () => {
      throw genericForbidden;
    });

    await expect(
      LaikaTask.runPromise(repo.getAtom('notes/article')),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('propagates VersionMismatchError for a 409 conflict', async () => {
    const conflictError = Object.assign(new Error('Conflict'), { status: 409 });
    const repo = makeRepoWithGetContent(async () => {
      throw conflictError;
    });

    await expect(
      LaikaTask.runPromise(repo.getAtom('notes/article')),
    ).rejects.toBeInstanceOf(VersionMismatchError);
  });

  it('propagates VersionMismatchError for a 422 unprocessable entity', async () => {
    const unprocessableError = Object.assign(new Error('Unprocessable Entity'), { status: 422 });
    const repo = makeRepoWithGetContent(async () => {
      throw unprocessableError;
    });

    await expect(
      LaikaTask.runPromise(repo.getAtom('notes/article')),
    ).rejects.toBeInstanceOf(VersionMismatchError);
  });

  it('propagates InternalError for an unmapped status (500)', async () => {
    const serverError = Object.assign(new Error('Internal Server Error'), { status: 500 });
    const repo = makeRepoWithGetContent(async () => {
      throw serverError;
    });

    await expect(
      LaikaTask.runPromise(repo.getAtom('notes/article')),
    ).rejects.toBeInstanceOf(InternalError);
  });
});
