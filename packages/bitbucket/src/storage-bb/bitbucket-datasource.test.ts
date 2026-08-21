import * as Result from 'effect/Result';
import { ForbiddenError, InternalError, ServiceUnavailableError, UpstreamUnAuthorizedError } from 'laikacms/core';
import { describe, expect, it } from 'vitest';

import { BitbucketDataSource } from './bitbucket-datasource.js';

const WORKSPACE = 'test-workspace';
const REPO = 'test-repo';
const BRANCH = 'main';
const API_URL = 'https://api.bb.test/2.0';

// ---------------------------------------------------------------------------
// BitbucketDataSource has no direct unit tests. bitbucket-storage-repository
// .test.ts covers authorizationHeader precedence through the repository
// layer, but the constructor's missing-auth guard and encodePath's
// slash-preserving/per-segment encoding are untested by any file. These
// tests target BitbucketDataSource directly.
// ---------------------------------------------------------------------------

describe('BitbucketDataSource constructor', () => {
  it('throws InternalError when auth has none of appPassword/oauthToken/tokenProvider', () => {
    expect(
      () =>
        new BitbucketDataSource({
          workspace: WORKSPACE,
          repo: REPO,
          branch: BRANCH,
          auth: {},
          apiUrl: API_URL,
          fetch: async () => new Response(''),
        }),
    ).toThrow(InternalError);
    expect(
      () =>
        new BitbucketDataSource({
          workspace: WORKSPACE,
          repo: REPO,
          branch: BRANCH,
          auth: {},
          apiUrl: API_URL,
          fetch: async () => new Response(''),
        }),
    ).toThrow(/appPassword.*oauthToken.*tokenProvider/);
  });

  it('does not throw when only appPassword is given', () => {
    expect(
      () =>
        new BitbucketDataSource({
          workspace: WORKSPACE,
          repo: REPO,
          branch: BRANCH,
          auth: { appPassword: { username: 'alice', password: 'pw' } },
          apiUrl: API_URL,
          fetch: async () => new Response(''),
        }),
    ).not.toThrow();
  });

  it('does not throw when only oauthToken is given', () => {
    expect(
      () =>
        new BitbucketDataSource({
          workspace: WORKSPACE,
          repo: REPO,
          branch: BRANCH,
          auth: { oauthToken: 'tok' },
          apiUrl: API_URL,
          fetch: async () => new Response(''),
        }),
    ).not.toThrow();
  });

  it('does not throw when only tokenProvider is given', () => {
    expect(
      () =>
        new BitbucketDataSource({
          workspace: WORKSPACE,
          repo: REPO,
          branch: BRANCH,
          auth: { tokenProvider: () => 'tok' },
          apiUrl: API_URL,
          fetch: async () => new Response(''),
        }),
    ).not.toThrow();
  });
});

describe('BitbucketDataSource encodePath (via getFileContents URL)', () => {
  const captureRequestedUrl = (): { fetch: typeof fetch, urls: string[] } => {
    const urls: string[] = [];
    const fetch: typeof fetch = async input => {
      urls.push(typeof input === 'string' ? input : input.toString());
      return new Response('body', { status: 200 });
    };
    return { fetch, urls };
  };

  const makeSource = (fetchImpl: typeof fetch) =>
    new BitbucketDataSource({
      workspace: WORKSPACE,
      repo: REPO,
      branch: BRANCH,
      auth: { oauthToken: 'tok' },
      apiUrl: API_URL,
      fetch: fetchImpl,
    });

  it('preserves `/` separators while encoding each segment individually', async () => {
    const { fetch, urls } = captureRequestedUrl();
    const source = makeSource(fetch);
    await source.getFileContents('notes/sub dir/a file.md');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(
      `${API_URL}/repositories/${WORKSPACE}/${REPO}/src/${BRANCH}/notes/sub%20dir/a%20file.md`,
    );
  });

  it('encodes special characters like `%` and spaces per segment', async () => {
    const { fetch, urls } = captureRequestedUrl();
    const source = makeSource(fetch);
    await source.getFileContents('a%b/c d.txt');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(
      `${API_URL}/repositories/${WORKSPACE}/${REPO}/src/${BRANCH}/a%25b/c%20d.txt`,
    );
  });

  it('drops empty segments produced by leading/trailing/duplicate slashes', async () => {
    const { fetch, urls } = captureRequestedUrl();
    const source = makeSource(fetch);
    await source.getFileContents('/notes//a.md/');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(
      `${API_URL}/repositories/${WORKSPACE}/${REPO}/src/${BRANCH}/notes/a.md`,
    );
  });
});

describe('BitbucketDataSource errorForResponse (via getFileContents)', () => {
  const makeDs = (status: number, body = '') => {
    const fetchImpl: typeof fetch = async () => new Response(body, { status });
    return new BitbucketDataSource({
      workspace: WORKSPACE,
      repo: REPO,
      branch: BRANCH,
      auth: { oauthToken: 'tok' },
      apiUrl: API_URL,
      fetch: fetchImpl,
    });
  };

  it('maps 401 → UpstreamUnAuthorizedError', async () => {
    const result = await makeDs(401).getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(UpstreamUnAuthorizedError);
    }
  });

  it('maps 403 → ForbiddenError', async () => {
    const result = await makeDs(403).getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ForbiddenError);
    }
  });

  it('maps 500 → ServiceUnavailableError', async () => {
    const result = await makeDs(500).getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ServiceUnavailableError);
    }
  });

  it('maps 503 → ServiceUnavailableError', async () => {
    const result = await makeDs(503).getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ServiceUnavailableError);
    }
  });

  it('maps 422 (non-404/401/403/5xx) → InternalError', async () => {
    const result = await makeDs(422).getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(InternalError);
    }
  });

  it('includes parsed Bitbucket error message in the error when body is JSON', async () => {
    const body = JSON.stringify({ error: { message: 'repository access denied' } });
    const result = await makeDs(403, body).getFileContents('docs/readme.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ForbiddenError);
      expect((result.failure as ForbiddenError).message).toContain('repository access denied');
    }
  });
});
