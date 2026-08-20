import * as Result from 'effect/Result';
import { ForbiddenError, TooManyRequestsError, UpstreamUnAuthorizedError } from 'laikacms/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAppAuthMock = vi.fn();
const octokitConstructorMock = vi.fn();

vi.mock('@octokit/auth-app', () => ({
  createAppAuth: (options: unknown) => createAppAuthMock(options),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    constructor(options: unknown) {
      octokitConstructorMock(options);
    }
  },
}));

const { GithubDataSource } = await import('./github-datasource.js');

const APP_AUTH_OPTIONS = {
  owner: 'test-owner',
  repo: 'test-repo',
  branch: 'main',
  appId: '1',
  installationId: '1',
} as const;

describe('GithubDataSource.normalizePrivateKey', () => {
  beforeEach(() => {
    createAppAuthMock.mockReset();
    createAppAuthMock.mockReturnValue(async () => ({ token: 'installation-token' }));
  });

  const buildAndGetNormalizedKey = (privateKey: string): string => {
    new GithubDataSource({ ...APP_AUTH_OPTIONS, privateKey });
    const passedOptions = createAppAuthMock.mock.calls.at(-1)?.[0] as { privateKey: string };
    return passedOptions.privateKey;
  };

  it('strips literal \\n sequences into real newlines', () => {
    const raw = '-----BEGIN RSA PRIVATE KEY-----\\nMIIEow\\n-----END RSA PRIVATE KEY-----';
    expect(buildAndGetNormalizedKey(raw)).toBe(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
    );
  });

  it('strips surrounding double quotes', () => {
    const raw = '"-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----"';
    expect(buildAndGetNormalizedKey(raw)).toBe(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
    );
  });

  it('strips both literal \\n and surrounding quotes together', () => {
    const raw = '"-----BEGIN RSA PRIVATE KEY-----\\nMIIEow\\n-----END RSA PRIVATE KEY-----"';
    expect(buildAndGetNormalizedKey(raw)).toBe(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
    );
  });

  it('leaves an already-normalized key untouched', () => {
    const raw = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----';
    expect(buildAndGetNormalizedKey(raw)).toBe(raw);
  });

  it('does not touch quotes or newlines in the middle of the key', () => {
    const raw = '-----BEGIN"KEY-----\nmiddle\\nchunk\n-----END"KEY-----';
    // Only real newlines from \n-escapes are converted and only *leading/trailing* quotes
    // are stripped — embedded quotes are preserved.
    expect(buildAndGetNormalizedKey(raw)).toBe('-----BEGIN"KEY-----\nmiddle\nchunk\n-----END"KEY-----');
  });
});

describe('GithubDataSource.getOctokit token caching', () => {
  beforeEach(() => {
    createAppAuthMock.mockReset();
    octokitConstructorMock.mockReset();
    vi.useRealTimers();
  });

  const makeAppAuthDataSource = (tokenTtlSeconds?: number) => {
    const authFn = vi.fn(async () => ({ token: 'installation-token' }));
    createAppAuthMock.mockReturnValue(authFn);
    const ds = new GithubDataSource({
      ...APP_AUTH_OPTIONS,
      privateKey: 'fake-key',
      ...(tokenTtlSeconds !== undefined ? { tokenTtlSeconds } : {}),
    });
    return { ds: ds as unknown as { getOctokit(): Promise<unknown> }, authFn };
  };

  it('mints a token on first call', async () => {
    const { ds, authFn } = makeAppAuthDataSource();
    await ds.getOctokit();
    expect(authFn).toHaveBeenCalledTimes(1);
    expect(octokitConstructorMock).toHaveBeenCalledTimes(1);
    expect(octokitConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ auth: 'installation-token' }),
    );
  });

  it('reuses the cached token on a second call before expiry (cache hit)', async () => {
    const { ds, authFn } = makeAppAuthDataSource();
    const first = await ds.getOctokit();
    const second = await ds.getOctokit();
    expect(authFn).toHaveBeenCalledTimes(1);
    expect(octokitConstructorMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('mints a fresh token once the cached one expires (cache miss)', async () => {
    vi.useFakeTimers();
    try {
      const { ds, authFn } = makeAppAuthDataSource(1); // tokenTtlSeconds=1 -> tokenTtlMs=1000
      const first = await ds.getOctokit();
      expect(authFn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1001);

      const second = await ds.getOctokit();
      expect(authFn).toHaveBeenCalledTimes(2);
      expect(octokitConstructorMock).toHaveBeenCalledTimes(2);
      expect(second).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not refresh the token before expiry', async () => {
    vi.useFakeTimers();
    try {
      const { ds, authFn } = makeAppAuthDataSource(60);
      await ds.getOctokit();
      vi.advanceTimersByTime(59_000);
      await ds.getOctokit();
      expect(authFn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GithubDataSource externalOctokit passthrough', () => {
  beforeEach(() => {
    createAppAuthMock.mockReset();
    octokitConstructorMock.mockReset();
  });

  it('does not construct app-auth or call createAppAuth when an octokit instance is supplied', () => {
    const externalOctokit = {
      repos: { getContent: vi.fn() },
      rest: { repos: { listCommits: vi.fn() } },
    };
    new GithubDataSource({
      owner: 'test-owner',
      repo: 'test-repo',
      branch: 'main',
      octokit: externalOctokit as never,
    });
    expect(createAppAuthMock).not.toHaveBeenCalled();
    expect(octokitConstructorMock).not.toHaveBeenCalled();
  });

  it('uses the supplied octokit instance directly for requests, bypassing installation-token minting', async () => {
    const getContent = vi.fn(async () => ({
      data: { type: 'file', encoding: 'base64', content: 'aGVsbG8=', sha: 'abc123' },
    }));
    const externalOctokit = {
      repos: { getContent },
      rest: { repos: { listCommits: vi.fn(async () => ({ data: [], headers: {} })) } },
    };
    const ds = new GithubDataSource({
      owner: 'test-owner',
      repo: 'test-repo',
      branch: 'main',
      octokit: externalOctokit as never,
    });

    const result = await ds.getFileContents('some/path.md');

    expect(getContent).toHaveBeenCalledTimes(1);
    expect(createAppAuthMock).not.toHaveBeenCalled();
    expect(octokitConstructorMock).not.toHaveBeenCalled();
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ content: 'hello', sha: 'abc123', path: 'some/path.md' });
    }
  });

  it('returns the exact same externalOctokit instance across repeated getOctokit calls', async () => {
    const externalOctokit = {
      repos: { getContent: vi.fn() },
      rest: { repos: { listCommits: vi.fn() } },
    };
    const ds = new GithubDataSource({
      owner: 'test-owner',
      repo: 'test-repo',
      branch: 'main',
      octokit: externalOctokit as never,
    }) as unknown as { getOctokit(): Promise<unknown> };

    const first = await ds.getOctokit();
    const second = await ds.getOctokit();
    expect(first).toBe(externalOctokit);
    expect(second).toBe(externalOctokit);
  });
});

describe('GithubDataSource.mapError', () => {
  const makeDs = (octokitError: object) => {
    const externalOctokit = {
      repos: { getContent: vi.fn().mockRejectedValue(octokitError) },
      rest: { repos: { listCommits: vi.fn() } },
    };
    return new GithubDataSource({
      owner: 'test-owner',
      repo: 'test-repo',
      branch: 'main',
      octokit: externalOctokit as never,
    });
  };

  it('maps 401 → UpstreamUnAuthorizedError', async () => {
    const ds = makeDs({ status: 401, message: 'Unauthorized' });
    const result = await ds.getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    expect(Result.isFailure(result) && result.failure).toBeInstanceOf(UpstreamUnAuthorizedError);
  });

  it('maps 403 without rate-limit header → ForbiddenError', async () => {
    const ds = makeDs({ status: 403, message: 'Forbidden' });
    const result = await ds.getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    expect(Result.isFailure(result) && result.failure).toBeInstanceOf(ForbiddenError);
  });

  it('maps 403 with "Resource not accessible by" message → ForbiddenError', async () => {
    const ds = makeDs({ status: 403, message: 'Resource not accessible by integration' });
    const result = await ds.getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    expect(Result.isFailure(result) && result.failure).toBeInstanceOf(ForbiddenError);
  });

  it('maps 403 with x-ratelimit-remaining=0 → TooManyRequestsError', async () => {
    const ds = makeDs({
      status: 403,
      message: 'Forbidden',
      response: { headers: { 'x-ratelimit-remaining': '0' } },
    });
    const result = await ds.getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    expect(Result.isFailure(result) && result.failure).toBeInstanceOf(TooManyRequestsError);
  });
});
