import * as Result from 'effect/Result';
import { describe, expect, it } from 'vitest';

import { DirInsteadOfFile, FileInsteadOfDir, InternalError, NotFoundError, TooManyRequestsError } from 'laikacms/core';

import { GithubCdnDataSource } from './github-cdn-datasource.js';

const OWNER = 'acme';
const REPO = 'docs';
const DATA_API_BASE = 'https://data.jsdelivr.test/v1/packages/gh';
const CDN_BASE = 'https://cdn.jsdelivr.test/gh';

const TREE_FILES = [
  {
    type: 'directory',
    name: 'posts',
    files: [
      { type: 'file', name: 'hello.md', hash: 'sha-hello' },
      {
        type: 'directory',
        name: 'sub',
        files: [{ type: 'file', name: 'nested.md', hash: 'sha-nested' }],
      },
    ],
  },
  { type: 'file', name: 'readme.md', hash: 'sha-readme' },
];

const FILE_BODIES: Record<string, string> = {
  'posts/hello.md': '# hello',
  'posts/sub/nested.md': '# nested',
  'readme.md': '# readme',
};

interface FakeFetchOptions {
  treeStatus?: number;
  treeFailOnce?: boolean;
  contentStatus?: (path: string) => number | undefined;
}

/** Builds a fetch stub serving a canned jsDelivr tree + per-path file bodies. */
const makeFakeFetch = (opts: FakeFetchOptions = {}) => {
  const calls: string[] = [];
  let treeCallCount = 0;

  const fetchImpl: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.toString());

    if (url.toString().startsWith(DATA_API_BASE)) {
      treeCallCount++;
      if (opts.treeFailOnce && treeCallCount === 1) {
        return new Response('boom', { status: 500 });
      }
      if (opts.treeStatus && opts.treeStatus !== 200) {
        return new Response('error', { status: opts.treeStatus });
      }
      return new Response(JSON.stringify({ files: TREE_FILES }), { status: 200 });
    }

    if (url.toString().startsWith(CDN_BASE)) {
      const path = decodeURIComponent(url.pathname.split('@HEAD/')[1] ?? '');
      const forcedStatus = opts.contentStatus?.(path);
      if (forcedStatus !== undefined) {
        return new Response('', { status: forcedStatus });
      }
      const body = FILE_BODIES[path];
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, { status: 200 });
    }

    throw new Error(`Unexpected fetch to ${url.toString()}`);
  };

  return { fetchImpl, calls, treeCallCount: () => treeCallCount };
};

const makeDataSource = (opts: FakeFetchOptions & { fetchMeta?: boolean } = {}) => {
  const { fetchImpl, calls, treeCallCount } = makeFakeFetch(opts);
  const ds = new GithubCdnDataSource({
    owner: OWNER,
    repo: REPO,
    fetchMeta: opts.fetchMeta,
    cdnBaseUrl: CDN_BASE,
    dataApiBaseUrl: DATA_API_BASE,
    fetch: fetchImpl,
  });
  return { ds, calls, treeCallCount };
};

describe('GithubCdnDataSource.getFileContents', () => {
  it('returns content and a computed git blob sha on success', async () => {
    const { ds } = makeDataSource();
    const result = await ds.getFileContents('posts/hello.md');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.content).toBe('# hello');
      expect(result.success.path).toBe('posts/hello.md');
      // sha1("blob 7\0# hello")
      expect(result.success.sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('fails with NotFoundError on a 404', async () => {
    const { ds } = makeDataSource();
    const result = await ds.getFileContents('posts/missing.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(NotFoundError);
  });

  it('fails with TooManyRequestsError on a 429', async () => {
    const { ds } = makeDataSource({ contentStatus: () => 429 });
    const result = await ds.getFileContents('posts/hello.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(TooManyRequestsError);
  });

  it('fails with InternalError on other non-ok statuses', async () => {
    const { ds } = makeDataSource({ contentStatus: () => 503 });
    const result = await ds.getFileContents('posts/hello.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(InternalError);
  });

  it('fails with InternalError when fetch itself throws', async () => {
    const ds = new GithubCdnDataSource({
      owner: OWNER,
      repo: REPO,
      cdnBaseUrl: CDN_BASE,
      dataApiBaseUrl: DATA_API_BASE,
      fetch: async () => {
        throw new Error('network down');
      },
    });
    const result = await ds.getFileContents('posts/hello.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(InternalError);
      expect(result.failure.message).toContain('network down');
    }
  });
});

describe('GithubCdnDataSource.getFileMeta', () => {
  it('returns epoch(0) timestamps and the tree hash by default (fetchMeta=false)', async () => {
    const { ds } = makeDataSource();
    const result = await ds.getFileMeta('posts/hello.md');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.sha).toBe('sha-hello');
      expect(result.success.createdAt.getTime()).toBe(0);
      expect(result.success.updatedAt.getTime()).toBe(0);
    }
  });

  it('computes the canonical git blob sha when fetchMeta=true', async () => {
    const { ds } = makeDataSource({ fetchMeta: true });
    const result = await ds.getFileMeta('posts/hello.md');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.success.sha).not.toBe('sha-hello');
    }
  });

  it('fails with NotFoundError for a missing path', async () => {
    const { ds } = makeDataSource();
    const result = await ds.getFileMeta('posts/missing.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(NotFoundError);
  });

  it('fails with DirInsteadOfFile when the path is a directory', async () => {
    const { ds } = makeDataSource();
    const result = await ds.getFileMeta('posts');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(DirInsteadOfFile);
  });
});

describe('GithubCdnDataSource.listDirectory', () => {
  it('lists immediate children of the root', async () => {
    const { ds } = makeDataSource();
    const result = await ds.listDirectory('');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const names = result.success.map(e => e.name).sort();
      expect(names).toEqual(['posts', 'readme.md']);
      const posts = result.success.find(e => e.name === 'posts');
      expect(posts?.type).toBe('dir');
      const readme = result.success.find(e => e.name === 'readme.md');
      expect(readme?.type).toBe('file');
      expect(readme?.sha).toBe('sha-readme');
    }
  });

  it('lists nested children with a path-prefixed key', async () => {
    const { ds } = makeDataSource();
    const result = await ds.listDirectory('posts');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const paths = result.success.map(e => e.path).sort();
      expect(paths).toEqual(['posts/hello.md', 'posts/sub']);
    }
  });

  it('returns an empty success list for a missing directory', async () => {
    const { ds } = makeDataSource();
    const result = await ds.listDirectory('does-not-exist');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success).toEqual([]);
  });

  it('fails with FileInsteadOfDir when the path is a file', async () => {
    const { ds } = makeDataSource();
    const result = await ds.listDirectory('readme.md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(FileInsteadOfDir);
  });
});

describe('GithubCdnDataSource.pathType', () => {
  it('resolves a file path', async () => {
    const { ds } = makeDataSource();
    await expect(ds.pathType('readme.md')).resolves.toBe('file');
  });

  it('resolves a directory path', async () => {
    const { ds } = makeDataSource();
    await expect(ds.pathType('posts')).resolves.toBe('dir');
  });

  it('throws NotFoundError for a missing path', async () => {
    const { ds } = makeDataSource();
    await expect(ds.pathType('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('GithubCdnDataSource tree caching', () => {
  it('fetches the repo tree at most once across multiple listDirectory calls', async () => {
    const { ds, treeCallCount } = makeDataSource();
    await ds.listDirectory('posts');
    await ds.listDirectory('');
    await ds.pathType('readme.md');
    expect(treeCallCount()).toBe(1);
  });

  it('cache-busts and retries the tree fetch after a failed attempt', async () => {
    const { ds, treeCallCount } = makeDataSource({ treeFailOnce: true });
    const first = await ds.listDirectory('');
    expect(Result.isFailure(first)).toBe(true);
    if (Result.isFailure(first)) expect(first.failure).toBeInstanceOf(InternalError);

    const second = await ds.listDirectory('');
    expect(Result.isSuccess(second)).toBe(true);
    expect(treeCallCount()).toBe(2);
  });
});
