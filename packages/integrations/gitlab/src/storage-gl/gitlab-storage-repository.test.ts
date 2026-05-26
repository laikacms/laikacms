import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitlabStorageRepository } from './gitlab-storage-repository.js';

// ---------------------------------------------------------------------------
// Tiny in-memory GitLab REST v4 mock — implements just enough of the surface
// area to drive the repository: file get/post/put/delete, repository tree
// listing with pagination headers, and commits-for-path metadata.
// ---------------------------------------------------------------------------

interface MockFile {
  content: string;
  blob_id: string;
  last_commit_id: string;
  committed_date: string;
  created_date: string;
}

const PROJECT_ID = '42';
const BRANCH = 'main';
const API_URL = 'https://gl.test/api/v4';

const createMockServer = () => {
  const files = new Map<string, MockFile>();
  let commitCounter = 0;

  const newCommitId = (): string => {
    commitCounter += 1;
    return `commit-${commitCounter}`;
  };

  const segmentsOf = (path: string): string[] => path.split('/').filter(s => s.length > 0);

  const directChildren = (parent: string): Array<{ name: string, path: string, type: 'tree' | 'blob' }> => {
    const parentSegs = segmentsOf(parent);
    const seenDirs = new Set<string>();
    const out: Array<{ name: string, path: string, type: 'tree' | 'blob' }> = [];
    for (const path of files.keys()) {
      const segs = segmentsOf(path);
      // Must be inside `parent`.
      if (parentSegs.length >= segs.length) continue;
      let mismatch = false;
      for (let i = 0; i < parentSegs.length; i++) {
        if (segs[i] !== parentSegs[i]) {
          mismatch = true;
          break;
        }
      }
      if (mismatch) continue;
      if (segs.length === parentSegs.length + 1) {
        out.push({ name: segs[segs.length - 1], path: segs.join('/'), type: 'blob' });
      } else {
        // Intermediate directory — surface it once.
        const dirSegs = segs.slice(0, parentSegs.length + 1);
        const dirPath = dirSegs.join('/');
        if (!seenDirs.has(dirPath)) {
          seenDirs.add(dirPath);
          out.push({ name: dirSegs[dirSegs.length - 1], path: dirPath, type: 'tree' });
        }
      }
    }
    return out;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;
    const projectPrefix = `/api/v4/projects/${PROJECT_ID}`;

    // ---- Get a file: GET /projects/:id/repository/files/:file_path ----
    const fileMatch = pathname.match(
      new RegExp(`^${projectPrefix.replace(/\//g, '\\/')}\\/repository\\/files\\/(.+)$`),
    );
    if (fileMatch && method === 'GET') {
      const filePath = decodeURIComponent(fileMatch[1]);
      const file = files.get(filePath);
      if (!file) return new Response('{"message":"404 File Not Found"}', { status: 404 });
      return new Response(
        JSON.stringify({
          file_path: filePath,
          file_name: filePath.split('/').pop(),
          encoding: 'base64',
          content: file.content,
          blob_id: file.blob_id,
          commit_id: file.last_commit_id,
          last_commit_id: file.last_commit_id,
          size: file.content.length,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (fileMatch && method === 'POST') {
      const filePath = decodeURIComponent(fileMatch[1]);
      if (files.has(filePath)) {
        return new Response('{"message":"A file with this name already exists"}', { status: 400 });
      }
      const body = JSON.parse((init?.body as string) ?? '{}');
      const now = new Date().toISOString();
      files.set(filePath, {
        content: body.content ?? '',
        blob_id: `blob-${filePath}-${Date.now()}`,
        last_commit_id: newCommitId(),
        committed_date: now,
        created_date: now,
      });
      return new Response(JSON.stringify({ file_path: filePath, branch: body.branch }), { status: 201 });
    }
    if (fileMatch && method === 'PUT') {
      const filePath = decodeURIComponent(fileMatch[1]);
      const file = files.get(filePath);
      if (!file) return new Response('{"message":"404 File Not Found"}', { status: 404 });
      const body = JSON.parse((init?.body as string) ?? '{}');
      const updated: MockFile = {
        ...file,
        content: body.content ?? file.content,
        last_commit_id: newCommitId(),
        committed_date: new Date().toISOString(),
      };
      files.set(filePath, updated);
      return new Response(JSON.stringify({ file_path: filePath, branch: body.branch }), { status: 200 });
    }
    if (fileMatch && method === 'DELETE') {
      const filePath = decodeURIComponent(fileMatch[1]);
      if (!files.has(filePath)) return new Response('{"message":"404 File Not Found"}', { status: 404 });
      files.delete(filePath);
      return new Response(null, { status: 204 });
    }

    // ---- List repository tree ----
    if (pathname === `${projectPrefix}/repository/tree` && method === 'GET') {
      const path = url.searchParams.get('path') ?? '';
      const perPage = Number(url.searchParams.get('per_page') ?? '20');
      const page = Number(url.searchParams.get('page') ?? '1');
      const entries = directChildren(path);
      if (entries.length === 0 && path !== '') {
        // A non-root path that isn't a real directory either: 404.
        // (We treat the root as always existing.)
        const isPrefix = [...files.keys()].some(p => p.startsWith(`${path}/`));
        if (!isPrefix) return new Response('{"message":"404 Tree Not Found"}', { status: 404 });
      }
      const start = (page - 1) * perPage;
      const slice = entries.slice(start, start + perPage);
      const totalPages = Math.max(1, Math.ceil(entries.length / perPage));
      const nextPage = page < totalPages ? String(page + 1) : '';
      const body = slice.map(e => ({
        id: `tree-${e.path}`,
        name: e.name,
        type: e.type,
        path: e.path,
        mode: '100644',
      }));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Total': String(entries.length),
          'X-Total-Pages': String(totalPages),
          'X-Page': String(page),
          'X-Per-Page': String(perPage),
          'X-Next-Page': nextPage,
        },
      });
    }

    // ---- Commits for a path ----
    if (pathname === `${projectPrefix}/repository/commits` && method === 'GET') {
      const path = url.searchParams.get('path') ?? '';
      const file = files.get(path);
      if (!file) return new Response('[]', { status: 200, headers: { 'X-Total-Pages': '0' } });
      return new Response(
        JSON.stringify([{
          id: file.last_commit_id,
          committed_date: file.committed_date,
          authored_date: file.committed_date,
          created_at: file.committed_date,
        }]),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Total-Pages': '1' },
        },
      );
    }

    return new Response(`{"unhandled":"${method} ${pathname}"}`, { status: 501 });
  };

  return { files, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let server: ReturnType<typeof createMockServer>;

beforeEach(() => {
  server = createMockServer();
});
afterEach(() => {
  server.files.clear();
});

const makeRepo = () =>
  new GitlabStorageRepository({
    projectId: PROJECT_ID,
    branch: BRANCH,
    apiUrl: API_URL,
    auth: { token: 'glpat-test' },
    fetch: server.fetch,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

const seedFile = (path: string, content = ''): void => {
  // The repository's encoded content is base64; tests check via the public
  // API so we encode here too.
  const encoded = btoa(content);
  server.files.set(path, {
    content: encoded,
    blob_id: `blob-${path}`,
    last_commit_id: `commit-seed-${path}`,
    committed_date: new Date('2026-01-01').toISOString(),
    created_date: new Date('2026-01-01').toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Tests — mirror the contract assertions from storage-fs / github / webdav.
// ---------------------------------------------------------------------------

describe('GitlabStorageRepository listing', () => {
  it('lists files at the root (with extensions stripped)', async () => {
    seedFile('hello.md', 'hi');
    seedFile('world.md', 'hello');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key).sort()).toEqual(['hello', 'world']);
    expect(collected.data.every(s => s.type === 'object-summary')).toBe(true);
  });

  it('lists nested files as folders + objects under the parent', async () => {
    seedFile('notes/a.md', 'a');
    seedFile('notes/b.md', 'b');
    seedFile('other.md', 'x');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', other: 'object-summary' });
  });

  it('reports a missing folder as a recoverable NotFoundError, not a fatal failure', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('does/not/exist', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('GitlabStorageRepository CRUD round-trip', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toBeTruthy();
    expect(server.files.has('hello.md')).toBe(true);

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(server.files.has('hello.md')).toBe(false);
  });

  it('rejects a second createObject for the same key', async () => {
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

  it('createFolder writes a .keep file so the folder shows up in listings', async () => {
    const repo = makeRepo();

    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    expect(server.files.has('notes/.keep')).toBe(true);

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['notes']);
    expect(collected.data[0].type).toBe('folder-summary');
  });
});
