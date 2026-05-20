import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BitbucketStorageRepository } from './bitbucket-storage-repository.js';

// ---------------------------------------------------------------------------
// Tiny in-memory Bitbucket Cloud mock — handles:
//   GET  /repositories/{ws}/{repo}/src/{branch}/{path}          → file body
//   GET  /repositories/{ws}/{repo}/src/{branch}/{path}?format=meta → metadata
//   GET  /repositories/{ws}/{repo}/src/{branch}/{path}/         → dir listing
//   POST /repositories/{ws}/{repo}/src                          → commit
// ---------------------------------------------------------------------------

const WS = 'esstudio';
const REPO = 'content';
const BRANCH = 'main';
const API_URL = 'https://mock.bitbucket.test/2.0';

interface MockFile {
  path: string;
  content: string;
  size: number;
  commitHash: string;
  updatedAt: string;
}

const segmentsOf = (path: string): string[] => path.split('/').filter(s => s.length > 0);
const parentOf = (path: string): string => {
  const segs = segmentsOf(path);
  return segs.length <= 1 ? '' : segs.slice(0, -1).join('/');
};

const createMockBitbucket = () => {
  const files = new Map<string, MockFile>();
  let commitCounter = 0;
  let lastAuthorization: string | undefined;

  const newCommit = (): string => `commit-${++commitCounter}`;

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    lastAuthorization = (init?.headers as Record<string, string> | undefined)?.['Authorization'];

    const repoPrefix = `/2.0/repositories/${WS}/${REPO}`;
    if (!url.pathname.startsWith(repoPrefix)) return new Response('bad url', { status: 404 });
    const rest = url.pathname.slice(repoPrefix.length);

    // POST /src — multipart commit
    if (rest === '/src' && method === 'POST') {
      const form = init?.body as FormData;
      const branch = form.get('branch');
      if (branch !== BRANCH) return json({ error: { message: 'bad branch' } }, { status: 400 });

      const hash = newCommit();
      const now = new Date().toISOString();
      const deletes = form.getAll('files').map(v => String(v));
      for (const path of deletes) files.delete(path);

      for (const [field, value] of form.entries()) {
        if (field === 'branch' || field === 'message' || field === 'author' || field === 'files') continue;
        // Field name is the path, value is the file body.
        const content = value instanceof Blob ? await value.text() : String(value);
        files.set(field, {
          path: field,
          content,
          size: content.length,
          commitHash: hash,
          updatedAt: now,
        });
      }
      return json({ hash });
    }

    // GET /src/{branch}/{path}[?format=meta] or .../  for dir
    const srcMatch = rest.match(/^\/src\/([^/]+)\/(.*)$/);
    if (srcMatch && method === 'GET') {
      const branch = decodeURIComponent(srcMatch[1]);
      if (branch !== BRANCH) return json({ error: { message: 'bad branch' } }, { status: 404 });
      const rawPath = srcMatch[2];
      const isDirRequest = rawPath.endsWith('/');
      const path = decodeURIComponent(isDirRequest ? rawPath.slice(0, -1) : rawPath);
      const wantsMeta = url.searchParams.get('format') === 'meta';

      if (isDirRequest) {
        // Directory listing
        const children = new Map<string, { type: 'file' | 'dir'; path: string; size?: number; commit?: string }>();
        const prefix = path === '' ? '' : `${path}/`;
        for (const file of files.values()) {
          if (path !== '' && !file.path.startsWith(prefix) && file.path !== path) continue;
          if (path === '' || file.path.startsWith(prefix)) {
            const rel = path === '' ? file.path : file.path.slice(prefix.length);
            if (rel === '') continue;
            const firstSlash = rel.indexOf('/');
            if (firstSlash === -1) {
              children.set(file.path, { type: 'file', path: file.path, size: file.size, commit: file.commitHash });
            } else {
              const subdir = path === '' ? rel.slice(0, firstSlash) : `${path}/${rel.slice(0, firstSlash)}`;
              children.set(subdir, { type: 'dir', path: subdir });
            }
          }
        }
        if (children.size === 0 && path !== '') {
          return json({ error: { message: 'Not found' } }, { status: 404 });
        }
        return json({
          values: [...children.values()].map(c => ({
            type: c.type === 'dir' ? 'commit_directory' : 'commit_file',
            path: c.path,
            size: c.size,
            commit: c.commit ? { hash: c.commit } : undefined,
          })),
        });
      }

      // Single file
      const file = files.get(path);
      if (!file) return json({ error: { message: 'Not found' } }, { status: 404 });
      if (wantsMeta) {
        return json({
          type: 'commit_file',
          path: file.path,
          size: file.size,
          commit: { hash: file.commitHash, date: file.updatedAt },
        });
      }
      return new Response(file.content, { status: 200 });
    }

    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { files, fetch: fetchImpl, lastAuth: () => lastAuthorization };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let bb: ReturnType<typeof createMockBitbucket>;

beforeEach(() => { bb = createMockBitbucket(); });
afterEach(() => { bb.files.clear(); });

const makeRepo = (overrides?: Partial<{ token: string }>) =>
  new BitbucketStorageRepository({
    workspace: WS,
    repo: REPO,
    branch: BRANCH,
    auth: overrides?.token
      ? { oauthToken: overrides.token }
      : { appPassword: { username: 'alice', password: 'app-pw' } },
    apiUrl: API_URL,
    fetch: bb.fetch,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
    commitAuthor: { name: 'Laika Bot', email: 'bot@example.com' },
  });

const seedFile = (path: string, content: string) => {
  bb.files.set(path, {
    path,
    content,
    size: content.length,
    commitHash: 'seed-commit',
    updatedAt: new Date('2026-05-01').toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BitbucketStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(bb.files.get('hello.md')?.content).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(bb.files.has('hello.md')).toBe(false);
  });

  it('rejects a duplicate createObject for the same key', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'one' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'hello', content: { body: 'two' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('createFolder writes a .keep marker so the folder shows up in listings', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    expect(bb.files.has('notes/.keep')).toBe(true);
  });
});

describe('BitbucketStorageRepository listing', () => {
  it('classifies files as object-summary (with extension stripped) and dirs as folder-summary', async () => {
    seedFile('notes/a.md', 'x');
    seedFile('notes/b.md', 'y');
    seedFile('top.md', 'z');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('reports a missing folder as a recoverable NotFoundError', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('does/not/exist', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('BitbucketStorageRepository auth', () => {
  it('sends HTTP Basic when configured with an app password', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'h', content: { body: 'x' } }),
    );
    // base64("alice:app-pw") = "YWxpY2U6YXBwLXB3"
    expect(bb.lastAuth()).toBe('Basic YWxpY2U6YXBwLXB3');
  });

  it('sends Bearer when configured with an OAuth2 token', async () => {
    const repo = makeRepo({ token: 'oauth-xyz' });
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'h', content: { body: 'x' } }),
    );
    expect(bb.lastAuth()).toBe('Bearer oauth-xyz');
  });
});
