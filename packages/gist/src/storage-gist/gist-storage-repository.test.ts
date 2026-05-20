import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decodeGistFilename, encodeGistFilename } from './gist-datasource.js';
import { GistStorageRepository } from './gist-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory GitHub Gist mock. Handles the two endpoints the data source
// touches (GET /gists/{id} + PATCH /gists/{id}) and counts how many PATCH
// calls fire so the atomic-multi-file-commit behaviour can be asserted.
// ---------------------------------------------------------------------------

const GIST_ID = 'gist-abc123';
const API_URL = 'https://mock.github.test';

interface MockFile {
  filename: string;
  content: string;
  size: number;
  raw_url: string;
  truncated: boolean;
}

const createMockGist = () => {
  const files = new Map<string, MockFile>();
  let createdAt = new Date('2026-01-01').toISOString();
  let updatedAt = createdAt;
  let historyCounter = 0;
  let patchCallCount = 0;

  const newVersion = (): string => `v${(++historyCounter).toString().padStart(8, '0')}`;

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const buildGistResponse = () => ({
    id: GIST_ID,
    created_at: createdAt,
    updated_at: updatedAt,
    history: [{ version: newVersion() }],
    files: Object.fromEntries(
      [...files.values()].map(f => [f.filename, {
        filename: f.filename,
        content: f.content,
        size: f.size,
        raw_url: f.raw_url,
        truncated: f.truncated,
      }]),
    ),
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (path === `/gists/${GIST_ID}` && method === 'GET') {
      return json(buildGistResponse());
    }

    if (path === `/gists/${GIST_ID}` && method === 'PATCH') {
      patchCallCount += 1;
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        files: Record<string, { content?: string } | null>;
      };
      for (const [filename, value] of Object.entries(body.files)) {
        if (value === null) {
          files.delete(filename);
        } else if (value.content !== undefined) {
          files.set(filename, {
            filename,
            content: value.content,
            size: value.content.length,
            raw_url: `${API_URL}/raw/${encodeURIComponent(filename)}`,
            truncated: false,
          });
        }
      }
      updatedAt = new Date().toISOString();
      return json(buildGistResponse());
    }

    return new Response(`{"unhandled":"${method} ${path}"}`, { status: 501 });
  };

  return { files, fetch: fetchImpl, patchCallCount: () => patchCallCount };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockGist>;

beforeEach(() => { mock = createMockGist(); });
afterEach(() => { mock.files.clear(); });

const makeRepo = () =>
  new GistStorageRepository({
    gistId: GIST_ID,
    auth: { token: 'gh_pat_test' },
    apiUrl: API_URL,
    fetch: mock.fetch,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Gist filename encoding', () => {
  it('round-trips slashes through `__` encoding', () => {
    expect(encodeGistFilename('notes/hello.md')).toBe('notes__hello.md');
    expect(decodeGistFilename('notes__hello.md')).toBe('notes/hello.md');
    expect(decodeGistFilename(encodeGistFilename('a/b/c.json'))).toBe('a/b/c.json');
  });
});

describe('GistStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(mock.files.get('hello.md')?.content).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(mock.files.has('hello.md')).toBe(false);
  });

  it('encodes `/` in keys as `__` on the wire', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'nested' } }),
    );
    expect(mock.files.has('notes__hello.md')).toBe(true);

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.key).toBe('notes/hello');
    expect(fetched.content).toEqual({ body: 'nested' });
  });

  it('rejects keys containing literal `__` (it\'s reserved as the slash encoding)', async () => {
    const repo = makeRepo();
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'foo__bar', content: { body: 'x' } }),
      ),
    ).rejects.toThrow(/reserved as the slash encoding/);
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
});

describe('GistStorageRepository removeAtoms uses one atomic commit', () => {
  it('packs multiple deletes into a single PATCH /gists/{id} call', async () => {
    const repo = makeRepo();
    // Seed three files via three creates, then watch how many PATCH calls
    // fire when we delete them all at once.
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'c', content: { body: 'c' } }));

    const callsBefore = mock.patchCallCount();
    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['a', 'b', 'c']));
    const callsAfter = mock.patchCallCount();

    expect(removed.data.sort()).toEqual(['a', 'b', 'c']);
    expect(callsAfter - callsBefore).toBe(1);
    expect(mock.files.size).toBe(0);
  });
});

describe('GistStorageRepository listing', () => {
  it('classifies files as object-summary and encoded-slash prefixes as folder-summary', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'top', content: { body: 'x' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'y' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('sorts numeric filenames naturally', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '1', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '10', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '2', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10']);
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

describe('GistStorageRepository folder semantics', () => {
  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }));

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect(mock.files.has('notes__a.md')).toBe(true);
  });

  it('refuses to delete the storage root', async () => {
    const attempt = await LaikaStream.runPromiseCollect(makeRepo().removeAtoms(['']));
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
  });
});
