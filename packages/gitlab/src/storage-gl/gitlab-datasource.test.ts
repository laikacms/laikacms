import { InternalError } from 'laikacms/core';
import { describe, expect, it } from 'vitest';

import { GitlabDataSource } from './gitlab-datasource.js';

const BRANCH = 'main';
const API_URL = 'https://gl.test/api/v4';

/** A `fetch` stub that records every call's URL + headers and returns a 200 empty-tree response. */
const recordingFetch = (calls: Array<{ url: string, headers: Record<string, string> }>): typeof fetch => {
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k] = v;
    }
    calls.push({ url, headers });
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Next-Page': '' },
    });
  }) as typeof fetch;
  return impl;
};

describe('GitlabDataSource — buildAuthHeaders precedence', () => {
  it('sends `Authorization: Bearer …` when `oauthToken` is set', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: '42',
      branch: BRANCH,
      apiUrl: API_URL,
      auth: { oauthToken: 'oauth-abc', token: 'pat-should-be-ignored', jobToken: 'job-should-be-ignored' },
      fetch: recordingFetch(calls),
    });
    await ds.listDirectory('');
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['Authorization']).toBe('Bearer oauth-abc');
    expect(calls[0].headers['PRIVATE-TOKEN']).toBeUndefined();
    expect(calls[0].headers['JOB-TOKEN']).toBeUndefined();
  });

  it('sends `PRIVATE-TOKEN` when `token` is set and no `oauthToken`', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: '42',
      branch: BRANCH,
      apiUrl: API_URL,
      auth: { token: 'pat-xyz', jobToken: 'job-should-be-ignored' },
      fetch: recordingFetch(calls),
    });
    await ds.listDirectory('');
    expect(calls[0].headers['PRIVATE-TOKEN']).toBe('pat-xyz');
    expect(calls[0].headers['Authorization']).toBeUndefined();
    expect(calls[0].headers['JOB-TOKEN']).toBeUndefined();
  });

  it('sends `JOB-TOKEN` when only `jobToken` is set', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: '42',
      branch: BRANCH,
      apiUrl: API_URL,
      auth: { jobToken: 'job-123' },
      fetch: recordingFetch(calls),
    });
    await ds.listDirectory('');
    expect(calls[0].headers['JOB-TOKEN']).toBe('job-123');
    expect(calls[0].headers['Authorization']).toBeUndefined();
    expect(calls[0].headers['PRIVATE-TOKEN']).toBeUndefined();
  });

  it('sends no auth header when `auth` is omitted, but keeps any extra `headers`', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: '42',
      branch: BRANCH,
      apiUrl: API_URL,
      auth: { headers: { 'X-Custom': 'yes' } },
      fetch: recordingFetch(calls),
    });
    await ds.listDirectory('');
    expect(calls[0].headers['Authorization']).toBeUndefined();
    expect(calls[0].headers['PRIVATE-TOKEN']).toBeUndefined();
    expect(calls[0].headers['JOB-TOKEN']).toBeUndefined();
    expect(calls[0].headers['X-Custom']).toBe('yes');
  });
});

describe('GitlabDataSource — constructor', () => {
  it('throws InternalError when no `fetch` implementation is available', () => {
    const originalFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = undefined;
    try {
      expect(
        () => new GitlabDataSource({ projectId: '42', branch: BRANCH }),
      ).toThrow(InternalError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not throw when a `fetch` implementation is passed explicitly', () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    expect(
      () =>
        new GitlabDataSource({
          projectId: '42',
          branch: BRANCH,
          fetch: recordingFetch(calls),
        }),
    ).not.toThrow();
  });
});

describe('GitlabDataSource — url() project-path encoding and query building', () => {
  it('uses the numeric project id as-is in the path', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: 12345,
      branch: BRANCH,
      apiUrl: API_URL,
      fetch: recordingFetch(calls),
    });
    await ds.listDirectory('');
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/v4/projects/12345/repository/tree');
  });

  it('URL-encodes a `group/project` path form', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: 'my-group/my-project',
      branch: BRANCH,
      apiUrl: API_URL,
      fetch: recordingFetch(calls),
    });
    await ds.listDirectory('');
    // `/` inside the project-path segment must stay percent-encoded — it is one
    // path segment (`my-group%2Fmy-project`), not two nested ones.
    expect(calls[0].url).toContain('/projects/my-group%2Fmy-project/repository/tree');
  });

  it('URL-encodes nested group paths', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: 'group/subgroup/project',
      branch: BRANCH,
      apiUrl: API_URL,
      fetch: recordingFetch(calls),
    });
    await ds.listDirectory('');
    expect(calls[0].url).toContain('/projects/group%2Fsubgroup%2Fproject/repository/tree');
  });

  it('builds the query string, dropping undefined values', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: '42',
      branch: BRANCH,
      apiUrl: API_URL,
      fetch: recordingFetch(calls),
    });
    // `path` is omitted for the root listing, so `listDirectory('')` builds a
    // query without a `path` param but with `ref`, `per_page`, and `page`.
    await ds.listDirectory('');
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('ref')).toBe(BRANCH);
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('path')).toBe(false);
  });

  it('includes a non-empty `path` in the query string', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: '42',
      branch: BRANCH,
      apiUrl: API_URL,
      fetch: recordingFetch(calls),
    });
    await ds.listDirectory('some/dir');
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('path')).toBe('some/dir');
  });

  it('omits the query string entirely when there is nothing to send', async () => {
    const calls: Array<{ url: string, headers: Record<string, string> }> = [];
    const ds = new GitlabDataSource({
      projectId: '42',
      branch: BRANCH,
      apiUrl: API_URL,
      fetch: recordingFetch(calls),
    });
    await ds.createOrUpdate('some/file.json', '{}');
    expect(calls[0].url).toBe(`${API_URL}/projects/42/repository/files/some%2Ffile.json`);
    expect(calls[0].url).not.toContain('?');
  });
});
