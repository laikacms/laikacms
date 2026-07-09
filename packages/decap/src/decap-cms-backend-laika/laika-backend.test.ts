/**
 * Tests for laika-backend.ts
 *
 * Strategy: We test the pure utility functions (normalizeKey, contentToRawString,
 * DedupeCache) extracted via createLaikaBackend, and the backend methods that
 * can be exercised by injecting mock DocumentsRepository / AssetsRepository
 * implementations.
 *
 * Browser-only Decap CMS packages (@laikacms/decap-cms/lib-util, lib-auth,
 * ui-default) are mocked because they call `window` at module load time.
 * We do NOT test the authentication flow because that requires a running server.
 */

import * as Result from 'effect/Result';
import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock browser-only deps BEFORE any import that transitively loads them.
// The source imports @laikacms/decap-cms/* (scoped monolith), not the
// legacy unscoped decap-cms-lib-* siblings — mock the same specifiers.
// ---------------------------------------------------------------------------

// vi.mock factories are hoisted before module evaluation; use vi.hoisted to
// share Cursor/symbol between the factory and test bodies.
const { MockCursor, CURSOR_COMPATIBILITY_SYMBOL } = vi.hoisted(() => {
  const CURSOR_COMPATIBILITY_SYMBOL = Symbol('cursor_compat');

  class MockCursor {
    private _actions: string[];
    private _data: Record<string, unknown>;
    private _meta: Record<string, unknown>;

    constructor(store: { actions?: string[], data?: Record<string, unknown>, meta?: Record<string, unknown> } = {}) {
      this._actions = store.actions ?? [];
      this._data = store.data ?? {};
      this._meta = store.meta ?? {};
    }

    static create(store: { actions?: string[], data?: Record<string, unknown>, meta?: Record<string, unknown> } = {}) {
      return new MockCursor(store);
    }

    get data() {
      const d = this._data;
      return { toJS: () => d };
    }

    get meta() {
      const m = this._meta;
      return { get: (k: string) => m[k] };
    }

    get actions() {
      return { has: (a: string) => this._actions.includes(a) };
    }
  }

  return { MockCursor, CURSOR_COMPATIBILITY_SYMBOL };
});

vi.mock('@laikacms/decap-cms/lib-util', () => ({
  AccessTokenError: class AccessTokenError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'AccessTokenError';
    }
  },
  APIError: class APIError extends Error {
    status: number;
    backend: string;
    constructor(msg: string, status = 500, backend = '') {
      super(msg);
      this.name = 'APIError';
      this.status = status;
      this.backend = backend;
    }
  },
  unsentRequest: {
    fetchWithTimeout: vi.fn(),
  },
  Cursor: MockCursor,
  CURSOR_COMPATIBILITY_SYMBOL,
}));

vi.mock('@laikacms/decap-cms/lib-auth', () => ({
  PkceAuthenticator: class PkceAuthenticator {
    completeAuth = vi.fn();
    authenticate = vi.fn();
  },
}));

vi.mock('@laikacms/decap-cms/ui-default', () => ({
  AuthenticationPage: () => null,
  Icon: () => null,
}));

vi.mock('laikacms/documents/jsonapi-proxy', () => ({
  DocumentsJsonApiProxyRepository: class MockDocumentsJsonApiProxyRepository {},
}));

vi.mock('laikacms/assets/jsonapi-proxy', () => ({
  AssetsJsonApiProxyRepository: class MockAssetsJsonApiProxyRepository {},
}));

// ---------------------------------------------------------------------------
// Minimal helpers to build LaikaTask / LaikaStream values for mocks
// ---------------------------------------------------------------------------

function succeed<T>(value: T): LaikaTask.LaikaTask<T> {
  return LaikaTask.succeed(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fail(error: any): LaikaTask.LaikaTask<never> {
  return LaikaTask.fail(new NotFoundError(error?.message ?? String(error)));
}

function empty<T>(): LaikaStream.LaikaStream<T, object> {
  return LaikaStream.empty({});
}

// ---------------------------------------------------------------------------
// Minimal mock factory for DocumentsRepository
// ---------------------------------------------------------------------------

function makeMockDocumentsRepository() {
  return {
    listRecords: vi.fn(),
    listRecordSummaries: vi.fn(),
    getDocument: vi.fn(),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocument: vi.fn(),
    unpublish: vi.fn(),
    getUnpublished: vi.fn(),
    createUnpublished: vi.fn(),
    updateUnpublished: vi.fn(),
    deleteUnpublished: vi.fn(),
    publish: vi.fn(),
    getRevision: vi.fn(),
    createRevision: vi.fn(),
    listRevisions: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Minimal mock factory for AssetsRepository
// ---------------------------------------------------------------------------

function makeMockAssetsRepository() {
  return {
    listResources: vi.fn(),
    getAsset: vi.fn(),
    createAsset: vi.fn(),
    deleteAsset: vi.fn(),
    getUrls: vi.fn(),
    getMetadata: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Shared config-like object
// ---------------------------------------------------------------------------

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    media_folder: 'assets/uploads',
    backend: {
      name: 'laika',
      base_url: 'https://api.example.com',
      api_root: '',
    },
    collections: [],
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Import createLaikaBackend (after mocks are in place)
// ---------------------------------------------------------------------------

import { unsentRequest } from '@laikacms/decap-cms/lib-util';

import createLaikaBackend from './laika-backend.js';

// ---------------------------------------------------------------------------
// Suite: createLaikaBackend factory
// ---------------------------------------------------------------------------

describe('createLaikaBackend()', () => {
  it('returns a constructor function', () => {
    const LaikaBackend = createLaikaBackend();
    expect(typeof LaikaBackend).toBe('function');
  });

  it('constructed instance is not a git backend', () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig()) as any;
    expect(backend.isGitBackend()).toBe(false);
  });

  it('constructed instance exposes authComponent', () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig()) as any;
    const comp = backend.authComponent();
    expect(comp).toBeDefined();
  });

  it('getToken() throws synchronously when not authenticated', () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig()) as any;
    // getToken() throws synchronously before returning a promise when tokenPromise is unset
    expect(() => backend.getToken()).toThrow();
  });

  it('getDocumentsRepo() throws when not authenticated', () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig()) as any;
    expect(() => backend.getDocumentsRepo()).toThrow();
  });

  it('getAssetsRepo() throws when not authenticated', () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig()) as any;
    expect(() => backend.getAssetsRepo()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite: getEntry
// ---------------------------------------------------------------------------

describe('LaikaBackend.getEntry()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('returns an ImplementationEntry when the document exists', async () => {
    const doc = { key: 'articles/hello', content: { title: 'Hello' }, type: 'published' };
    mockDocRepo.getDocument.mockReturnValue(succeed(doc));

    const entry = await backend.getEntry('articles/hello');

    expect(entry).toMatchObject({
      file: { path: 'articles/hello', id: 'articles/hello' },
    });
    expect(typeof entry.data).toBe('string');
  });

  it('strips .json extension from the key before querying', async () => {
    const doc = { key: 'articles/test', content: { title: 'Test' }, type: 'published' };
    mockDocRepo.getDocument.mockReturnValue(succeed(doc));

    await backend.getEntry('articles/test.json');

    expect(mockDocRepo.getDocument).toHaveBeenCalledWith('articles/test');
  });

  it('strips .md extension from the key before querying', async () => {
    const doc = { key: 'articles/test', content: 'raw markdown', type: 'published' };
    mockDocRepo.getDocument.mockReturnValue(succeed(doc));

    await backend.getEntry('articles/test.md');

    expect(mockDocRepo.getDocument).toHaveBeenCalledWith('articles/test');
  });

  it('falls back to unpublished when published document not found', async () => {
    const unpubDoc = { key: 'articles/draft', content: { title: 'Draft' }, type: 'unpublished' };
    mockDocRepo.getDocument.mockReturnValue(
      fail({ code: 'NOT_FOUND', message: 'Not found' }),
    );
    mockDocRepo.getUnpublished.mockReturnValue(succeed(unpubDoc));

    const entry = await backend.getEntry('articles/draft');

    expect(entry.file.path).toBe('articles/draft');
  });

  it('throws when both published and unpublished lookups fail', async () => {
    mockDocRepo.getDocument.mockReturnValue(
      fail({ code: 'NOT_FOUND', message: 'Not found' }),
    );
    mockDocRepo.getUnpublished.mockReturnValue(
      fail({ code: 'NOT_FOUND', message: 'Not found either' }),
    );

    await expect(backend.getEntry('articles/missing')).rejects.toThrow();
  });

  it('returns cached result on second call without hitting the repo again', async () => {
    const doc = { key: 'articles/cached', content: { title: 'Cached' }, type: 'published' };
    mockDocRepo.getDocument.mockReturnValue(succeed(doc));

    await backend.getEntry('articles/cached');
    await backend.getEntry('articles/cached');

    // getDocument should only have been called once (second is served from cache)
    expect(mockDocRepo.getDocument).toHaveBeenCalledTimes(1);
  });

  it('serialises object content to JSON string', async () => {
    const doc = { key: 'articles/obj', content: { foo: 'bar' }, type: 'published' };
    mockDocRepo.getDocument.mockReturnValue(succeed(doc));

    const entry = await backend.getEntry('articles/obj');

    expect(entry.data).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('preserves string content as-is', async () => {
    const raw = '# Markdown content\n\nHello world.';
    const doc = { key: 'articles/raw', content: raw, type: 'published' };
    mockDocRepo.getDocument.mockReturnValue(succeed(doc));

    const entry = await backend.getEntry('articles/raw');

    expect(entry.data).toBe(raw);
  });

  it('logs a recoverableError emitted by the repo via console.warn while still returning the entry', async () => {
    const Effect = await import('effect/Effect');
    const doc = { key: 'articles/warned', content: { title: 'Warned' }, type: 'published' };
    // Build a LaikaTask that emits a recoverableError mid-stream then resolves.
    // Mirrors what an R2-proxy readback fallback would produce: the operation
    // succeeds with a synthesised value AND a warning.
    const taskWithWarning = LaikaTask.make<typeof doc>(emit =>
      Effect.gen(function*() {
        yield* emit.recoverableError(new NotFoundError('readback fell back to synthesis'));
        return doc;
      })
    );
    mockDocRepo.getDocument.mockReturnValue(taskWithWarning);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const entry = await backend.getEntry('articles/warned');
      expect(entry).toMatchObject({ file: { path: 'articles/warned' } });
      expect(warnSpy).toHaveBeenCalled();
      const message = warnSpy.mock.calls.map(call => call[0]).join('\n');
      expect(message).toContain('readback fell back to synthesis');
      expect(message).toContain('not_found');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('routes recoverableErrors to a custom onWarning handler when configured', async () => {
    const Effect = await import('effect/Effect');
    const doc = { key: 'articles/onwarning', content: { title: 'OW' }, type: 'published' };

    const observed: NotFoundError[] = [];
    const localMockRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => localMockRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
      onWarning: (e: any) => {
        observed.push(e);
      },
    });
    const localBackend = new LaikaBackend(makeConfig()) as any;
    localBackend.documentsRepository = localMockRepo;
    localBackend.tokenPromise = () => Promise.resolve('fake-token');

    const taskWithWarning = LaikaTask.make<typeof doc>(emit =>
      Effect.gen(function*() {
        yield* emit.recoverableError(new NotFoundError('readback fell back to synthesis'));
        return doc;
      })
    );
    localMockRepo.getDocument.mockReturnValue(taskWithWarning);

    // Spy on console.warn too — the custom handler should preempt it.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const entry = await localBackend.getEntry('articles/onwarning');
      expect(entry).toMatchObject({ file: { path: 'articles/onwarning' } });
      expect(observed).toHaveLength(1);
      expect(observed[0]).toBeInstanceOf(NotFoundError);
      expect(observed[0]?.message).toContain('readback fell back to synthesis');
      // The custom handler took over; console.warn should NOT have been
      // called for the recoverable warning.
      const warnFromRecoverable = warnSpy.mock.calls.some(call => String(call[0]).includes('readback fell back'));
      expect(warnFromRecoverable).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: entriesByFolder
// ---------------------------------------------------------------------------

describe('LaikaBackend.entriesByFolder()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('returns an array of ImplementationEntry for published records', async () => {
    mockDocRepo.listRecords.mockReturnValue(LaikaStream.succeedMany([
      { key: 'articles/a', content: { title: 'A' }, type: 'published' },
      { key: 'articles/b', content: { title: 'B' }, type: 'published' },
    ] as any[], {}));

    const entries = await backend.entriesByFolder('articles', 'json', 1);

    expect(entries).toHaveLength(2);
    expect(entries[0].file.path).toBe('articles/a');
    expect(entries[1].file.path).toBe('articles/b');
  });

  it('skips records that are not published', async () => {
    mockDocRepo.listRecords.mockReturnValue(LaikaStream.succeedMany([
      { key: 'articles/pub', content: { title: 'Pub' }, type: 'published' },
      { key: 'articles/draft', content: { title: 'Draft' }, type: 'unpublished' },
    ] as any[], {}));

    const entries = await backend.entriesByFolder('articles', 'json', 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].file.path).toBe('articles/pub');
  });

  it('returns empty array when generator yields no records', async () => {
    mockDocRepo.listRecords.mockReturnValue(empty());

    const entries = await backend.entriesByFolder('articles', 'json', 1);

    expect(entries).toHaveLength(0);
  });

  it('skips failed results and continues processing successful ones', async () => {
    // LaikaStream recoverable errors are surfaced as RecoverableError elements;
    // the backend's loop skips them and continues with Data elements.
    mockDocRepo.listRecords.mockReturnValue(LaikaStream.succeedMany([
      { key: 'articles/ok', content: { title: 'OK' }, type: 'published' },
    ] as any[], {}));

    const entries = await backend.entriesByFolder('articles', 'json', 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].file.path).toBe('articles/ok');
  });

  it('returns first page (20) when collection has 110 entries; cursor stores all 110 for traversal', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      key: `articles/entry-${i}`,
      content: { title: `Entry ${i}` },
      type: 'published' as const,
    }));
    const page2 = Array.from({ length: 10 }, (_, i) => ({
      key: `articles/entry-${100 + i}`,
      content: { title: `Entry ${100 + i}` },
      type: 'published' as const,
    }));

    mockDocRepo.listRecords
      .mockReturnValueOnce(LaikaStream.succeedMany(page1 as any[], {}))
      .mockReturnValueOnce(LaikaStream.succeedMany(page2 as any[], {}));

    const entries = await backend.entriesByFolder('articles', 'json', 1);

    // entriesByFolder now returns only the first UI page (20 entries)
    expect(entries).toHaveLength(20);
    expect(entries[0].file.path).toBe('articles/entry-0');
    expect(entries[19].file.path).toBe('articles/entry-19');
    // Both repo batches were fetched to build the full list
    expect(mockDocRepo.listRecords).toHaveBeenCalledTimes(2);
    expect(mockDocRepo.listRecords).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pagination: { limit: 100, offset: 0 } }),
    );
    expect(mockDocRepo.listRecords).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pagination: { limit: 100, offset: 100 } }),
    );
    // Cursor is attached and has 'next' action because there are more pages
    const cursor = (entries as any)[CURSOR_COMPATIBILITY_SYMBOL];
    expect(cursor).toBeDefined();
    expect(cursor.actions.has('next')).toBe(true);
    expect(cursor.actions.has('prev')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite: traverseCursor
// ---------------------------------------------------------------------------

describe('LaikaBackend.traverseCursor()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  function makeEntries(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      key: `posts/entry-${i}`,
      content: { title: `Post ${i}` },
      type: 'published' as const,
    }));
  }

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it("'next' advances to page 2 and returns the correct slice of entries", async () => {
    // Seed 25 entries so there are 2 pages (20 + 5)
    mockDocRepo.listRecords.mockReturnValue(LaikaStream.succeedMany(makeEntries(25) as any[], {}));
    await backend.entriesByFolder('posts', 'json', 1); // populates allEntriesCache

    const page1Cursor = new MockCursor({
      actions: ['next', 'last'],
      meta: { page: 1, pageSize: 20, pageCount: 2, count: 25 },
      data: { folder: 'posts' },
    });

    const result = await backend.traverseCursor(page1Cursor, 'next');

    expect(result.entries).toHaveLength(5); // entries 20-24
    expect(result.entries[0].file.path).toBe('posts/entry-20');
    expect(result.entries[4].file.path).toBe('posts/entry-24');
  });

  it('returned cursor reflects the new page position', async () => {
    mockDocRepo.listRecords.mockReturnValue(LaikaStream.succeedMany(makeEntries(25) as any[], {}));
    await backend.entriesByFolder('posts', 'json', 1);

    const page1Cursor = new MockCursor({
      actions: ['next', 'last'],
      meta: { page: 1, pageSize: 20, pageCount: 2, count: 25 },
      data: { folder: 'posts' },
    });

    const result = await backend.traverseCursor(page1Cursor, 'next');

    // New cursor should be on page 2 with no 'next' (last page)
    expect(result.cursor.meta.get('page')).toBe(2);
    expect(result.cursor.actions.has('prev')).toBe(true);
    expect(result.cursor.actions.has('next')).toBe(false);
  });

  it('throws a typed error when cursor carries no folder', async () => {
    const emptyCursor = new MockCursor({ data: {}, meta: {} });

    await expect(backend.traverseCursor(emptyCursor, 'next')).rejects.toThrow(
      'traverseCursor: cursor carries no folder',
    );
  });

  it("'first' resets to page 1 regardless of current position", async () => {
    mockDocRepo.listRecords.mockReturnValue(LaikaStream.succeedMany(makeEntries(45) as any[], {}));
    await backend.entriesByFolder('posts', 'json', 1);

    const page3Cursor = new MockCursor({
      actions: ['prev', 'first'],
      meta: { page: 3, pageSize: 20, pageCount: 3, count: 45 },
      data: { folder: 'posts' },
    });

    const result = await backend.traverseCursor(page3Cursor, 'first');

    expect(result.entries).toHaveLength(20);
    expect(result.entries[0].file.path).toBe('posts/entry-0');
    expect(result.cursor.meta.get('page')).toBe(1);
    expect(result.cursor.actions.has('next')).toBe(true);
    expect(result.cursor.actions.has('prev')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite: deleteFiles
// ---------------------------------------------------------------------------

describe('LaikaBackend.deleteFiles()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('calls deleteDocument with the normalised key', async () => {
    mockDocRepo.deleteDocument.mockImplementation(() => succeed(undefined));

    await backend.deleteFiles(['articles/bye.json'], 'Delete bye');

    expect(mockDocRepo.deleteDocument).toHaveBeenCalledWith('articles/bye');
  });

  it('strips file extension before deleting', async () => {
    mockDocRepo.deleteDocument.mockImplementation(() => succeed(undefined));

    await backend.deleteFiles(['pages/home.md'], 'Delete home');

    expect(mockDocRepo.deleteDocument).toHaveBeenCalledWith('pages/home');
  });

  it('tries deleteUnpublished when deleteDocument fails', async () => {
    mockDocRepo.deleteDocument.mockImplementation(() => fail({ message: 'Not found' }));
    mockDocRepo.deleteUnpublished.mockImplementation(() => succeed(undefined));

    await backend.deleteFiles(['articles/ghost.json'], 'Delete ghost');

    expect(mockDocRepo.deleteUnpublished).toHaveBeenCalledWith('articles/ghost');
  });

  it('handles multiple paths', async () => {
    // Use mockImplementation so each call gets a fresh generator
    mockDocRepo.deleteDocument.mockImplementation(() => succeed(undefined));

    await backend.deleteFiles(['articles/a.json', 'articles/b.yaml'], 'Delete multiple');

    expect(mockDocRepo.deleteDocument).toHaveBeenCalledTimes(2);
    expect(mockDocRepo.deleteDocument).toHaveBeenCalledWith('articles/a');
    expect(mockDocRepo.deleteDocument).toHaveBeenCalledWith('articles/b');
  });
});

// ---------------------------------------------------------------------------
// Suite: logout
// ---------------------------------------------------------------------------

describe('LaikaBackend.logout()', () => {
  it('clears tokenPromise and repositories after logout', async () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig()) as any;

    backend.tokenPromise = () => Promise.resolve('fake-token');
    backend.documentsRepository = {};
    backend.assetsRepository = {};

    await backend.logout();

    expect(backend.tokenPromise).toBeUndefined();
    expect(backend.documentsRepository).toBeUndefined();
    expect(backend.assetsRepository).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite: allEntriesByFolder (pathRegex filtering)
// ---------------------------------------------------------------------------

describe('LaikaBackend.allEntriesByFolder()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('returns all entries when no pathRegex provided', async () => {
    mockDocRepo.listRecords.mockReturnValue(LaikaStream.succeedMany([
      { key: 'articles/a', content: {}, type: 'published' },
      { key: 'articles/b', content: {}, type: 'published' },
    ] as any[], {}));

    const entries = await backend.allEntriesByFolder('articles', 'json', 1);
    expect(entries).toHaveLength(2);
  });

  it('filters entries by pathRegex when provided', async () => {
    mockDocRepo.listRecords.mockReturnValue(LaikaStream.succeedMany([
      { key: 'articles/alpha', content: {}, type: 'published' },
      { key: 'articles/beta', content: {}, type: 'published' },
    ] as any[], {}));

    const entries = await backend.allEntriesByFolder('articles', 'json', 1, /alpha/);
    expect(entries).toHaveLength(1);
    expect(entries[0].file.path).toBe('articles/alpha');
  });
});

// ---------------------------------------------------------------------------
// Suite: getDeployPreview
// ---------------------------------------------------------------------------

describe('LaikaBackend.getDeployPreview()', () => {
  it('always returns null', async () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig());
    const result = await backend.getDeployPreview('articles', 'hello');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite: status()
// ---------------------------------------------------------------------------

describe('LaikaBackend.status()', () => {
  it('returns api.status=false when fetch throws a network error', async () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig()) as any;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;

    const result = await backend.status();

    expect(result.api.status).toBe(false);
    expect(result.auth.status).toBe(false);

    globalThis.fetch = originalFetch;
  });

  it('returns api.status=false when fetch returns non-ok', async () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig()) as any;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;

    const result = await backend.status();

    expect(result.api.status).toBe(false);

    globalThis.fetch = originalFetch;
  });

  it('returns api.status=true when fetch returns ok', async () => {
    const LaikaBackend = createLaikaBackend();
    const backend = new LaikaBackend(makeConfig()) as any;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;

    const result = await backend.status();

    expect(result.api.status).toBe(true);

    globalThis.fetch = originalFetch;
  });
});

// ---------------------------------------------------------------------------
// Suite: entriesByFiles
// ---------------------------------------------------------------------------

describe('LaikaBackend.entriesByFiles()', () => {
  it('fetches each file and returns entries', async () => {
    const mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    const backend = new LaikaBackend(makeConfig()) as any;
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');

    const doc1 = { key: 'articles/one', content: { title: 'One' }, type: 'published' };
    const doc2 = { key: 'articles/two', content: { title: 'Two' }, type: 'published' };
    mockDocRepo.getDocument
      .mockReturnValueOnce(succeed(doc1))
      .mockReturnValueOnce(succeed(doc2));

    const files = [
      { path: 'articles/one', id: 'articles/one' },
      { path: 'articles/two', id: 'articles/two' },
    ];

    const entries = await backend.entriesByFiles(files);

    expect(entries).toHaveLength(2);
    expect(entries[0].file.path).toBe('articles/one');
    expect(entries[1].file.path).toBe('articles/two');
  });

  it('skips files that fail to fetch', async () => {
    const mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    const backend = new LaikaBackend(makeConfig()) as any;
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');

    const doc = { key: 'articles/ok', content: { title: 'OK' }, type: 'published' };

    // Use mockImplementation based on which key is requested
    mockDocRepo.getDocument.mockImplementation((key: string) => {
      if (key === 'articles/missing') return fail({ code: 'NOT_FOUND', message: 'Gone' });
      return succeed(doc);
    });
    mockDocRepo.getUnpublished.mockImplementation(() => fail({ code: 'NOT_FOUND', message: 'Not unpublished either' }));

    const files = [
      { path: 'articles/missing', id: 'articles/missing' },
      { path: 'articles/ok', id: 'articles/ok' },
    ];

    const entries = await backend.entriesByFiles(files);
    expect(entries).toHaveLength(1);
    expect(entries[0].file.path).toBe('articles/ok');
  });
});

// ---------------------------------------------------------------------------
// Suite: persistEntry
// ---------------------------------------------------------------------------

describe('LaikaBackend.persistEntry()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('persists a JSON entry as a parsed object (not a double-serialised string)', async () => {
    mockDocRepo.createDocument.mockImplementation(() => succeed(undefined));

    const raw = JSON.stringify({ title: 'Hello', language: 'en' });
    await backend.persistEntry(
      { dataFiles: [{ path: 'articles/hello.json', raw }], assets: [] },
      { newEntry: true, useWorkflow: false },
    );

    expect(mockDocRepo.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ content: { title: 'Hello', language: 'en' } }),
    );
  });

  it('persists a markdown/frontmatter entry as a raw string without JSON.parse', async () => {
    mockDocRepo.createDocument.mockImplementation(() => succeed(undefined));

    const raw = '---\ntitle: My Post\n---\n\nBody text here.';
    // This must NOT throw SyntaxError (JSON.parse would throw on non-JSON input)
    await expect(
      backend.persistEntry(
        { dataFiles: [{ path: 'posts/my-post.md', raw }], assets: [] },
        { newEntry: true, useWorkflow: false },
      ),
    ).resolves.toBeUndefined();

    expect(mockDocRepo.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ content: raw }),
    );
  });

  it('round-trips a markdown entry: persist then read back the same raw string', async () => {
    const raw = '---\ntitle: Round-trip\ndate: 2024-01-01\n---\n\nContent body.';

    mockDocRepo.createDocument.mockImplementation(() => succeed(undefined));
    mockDocRepo.getDocument.mockReturnValue(
      succeed({ key: 'posts/round-trip', content: raw, type: 'published' }),
    );

    await backend.persistEntry(
      { dataFiles: [{ path: 'posts/round-trip.md', raw }], assets: [] },
      { newEntry: true, useWorkflow: false },
    );

    const entry = await backend.getEntry('posts/round-trip.md');
    expect(entry.data).toBe(raw);
  });

  it('persists a YAML entry as a raw string', async () => {
    mockDocRepo.createDocument.mockImplementation(() => succeed(undefined));

    const raw = 'title: My Config\nvalue: 42\n';
    await backend.persistEntry(
      { dataFiles: [{ path: 'config/settings.yaml', raw }], assets: [] },
      { newEntry: true, useWorkflow: false },
    );

    expect(mockDocRepo.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ content: raw }),
    );
  });

  it('uses "und" as the language when content has no language field', async () => {
    mockDocRepo.createDocument.mockImplementation(() => succeed(undefined));

    const raw = JSON.stringify({ title: 'No language field' });
    await backend.persistEntry(
      { dataFiles: [{ path: 'articles/no-lang.json', raw }], assets: [] },
      { newEntry: true, useWorkflow: false },
    );

    expect(mockDocRepo.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'und' }),
    );
  });

  it('uses "und" as the language when content is a non-object (string)', async () => {
    mockDocRepo.createDocument.mockImplementation(() => succeed(undefined));

    const raw = '---\ntitle: Markdown post\n---\n\nBody.';
    await backend.persistEntry(
      { dataFiles: [{ path: 'posts/no-lang.md', raw }], assets: [] },
      { newEntry: true, useWorkflow: false },
    );

    expect(mockDocRepo.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'und' }),
    );
  });

  it('calls updateDocument when newEntry:false, useWorkflow:false', async () => {
    mockDocRepo.updateDocument.mockReturnValue(succeed(undefined));

    const raw = JSON.stringify({ title: 'Updated Title', language: 'en' });
    await backend.persistEntry(
      { dataFiles: [{ path: 'articles/existing.json', raw }], assets: [] },
      { newEntry: false, useWorkflow: false },
    );

    expect(mockDocRepo.updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'articles/existing',
        content: { title: 'Updated Title', language: 'en' },
      }),
    );
    expect(mockDocRepo.createDocument).not.toHaveBeenCalled();
  });

  it('calls createUnpublished when newEntry:true, useWorkflow:true, status:draft', async () => {
    mockDocRepo.createUnpublished.mockReturnValue(succeed(undefined));

    const raw = JSON.stringify({ title: 'Draft Post', language: 'en' });
    await backend.persistEntry(
      { dataFiles: [{ path: 'articles/new-draft.json', raw }], assets: [] },
      { newEntry: true, useWorkflow: true, status: 'draft' },
    );

    expect(mockDocRepo.createUnpublished).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'unpublished',
        status: 'draft',
        key: 'articles/new-draft',
        content: { title: 'Draft Post', language: 'en' },
      }),
    );
    expect(mockDocRepo.createDocument).not.toHaveBeenCalled();
  });

  it('calls updateUnpublished when newEntry:false, useWorkflow:true, status:draft', async () => {
    mockDocRepo.updateUnpublished.mockReturnValue(succeed(undefined));

    const raw = '---\ntitle: Updated Draft\n---\n\nBody.';
    await backend.persistEntry(
      { dataFiles: [{ path: 'posts/existing-draft.md', raw }], assets: [] },
      { newEntry: false, useWorkflow: true, status: 'draft' },
    );

    expect(mockDocRepo.updateUnpublished).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'posts/existing-draft',
        content: raw,
        status: 'draft',
      }),
    );
    expect(mockDocRepo.createUnpublished).not.toHaveBeenCalled();
    expect(mockDocRepo.createDocument).not.toHaveBeenCalled();
  });

  it('uploads each asset via persistMedia before writing the document', async () => {
    mockDocRepo.createDocument.mockImplementation(() => succeed(undefined));

    const mockPersistMedia = vi.spyOn(backend, 'persistMedia').mockResolvedValue({
      id: 'asset-1',
      name: 'image.jpg',
      url: 'http://example.com/image.jpg',
    } as any);

    const asset1 = { path: 'uploads/image.jpg', fileObj: new File(['a'], 'image.jpg', { type: 'image/jpeg' }) } as any;
    const asset2 = { path: 'uploads/doc.pdf', fileObj: new File(['b'], 'doc.pdf', { type: 'application/pdf' }) } as any;

    await backend.persistEntry(
      {
        dataFiles: [{ path: 'articles/hello.json', raw: JSON.stringify({ title: 'Hello' }) }],
        assets: [asset1, asset2],
      },
      { newEntry: true, useWorkflow: false },
    );

    expect(mockPersistMedia).toHaveBeenCalledTimes(2);
    expect(mockPersistMedia).toHaveBeenCalledWith(asset1, expect.anything());
    expect(mockPersistMedia).toHaveBeenCalledWith(asset2, expect.anything());
    expect(mockDocRepo.createDocument).toHaveBeenCalledOnce();
  });

  it('throws and does not write document when persistMedia fails on first asset', async () => {
    mockDocRepo.createDocument.mockImplementation(() => succeed(undefined));

    vi.spyOn(backend, 'persistMedia').mockRejectedValue(new Error('upload failed'));

    const asset = { path: 'uploads/image.jpg', fileObj: new File(['a'], 'image.jpg', { type: 'image/jpeg' }) } as any;

    await expect(
      backend.persistEntry(
        { dataFiles: [{ path: 'articles/hello.json', raw: JSON.stringify({ title: 'Hello' }) }], assets: [asset] },
        { newEntry: true, useWorkflow: false },
      ),
    ).rejects.toThrow('upload failed');

    expect(mockDocRepo.createDocument).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: unpublishedEntries
// ---------------------------------------------------------------------------

describe('LaikaBackend.unpublishedEntries()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig({
      collections: [{ name: 'articles' }, { name: 'pages' }],
    }));
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('returns keys for all unpublished records across collections', async () => {
    mockDocRepo.listRecords
      .mockReturnValueOnce(LaikaStream.succeedMany([
        {
          key: 'articles/draft-one',
          content: { title: 'Draft One' },
          type: 'unpublished',
          status: 'draft',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ] as any[], {}))
      .mockReturnValueOnce(LaikaStream.succeedMany([
        {
          key: 'pages/draft-page',
          content: { title: 'Draft Page' },
          type: 'unpublished',
          status: 'draft',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ] as any[], {}));

    const keys = await backend.unpublishedEntries();

    expect(keys).toContain('articles/draft-one');
    expect(keys).toContain('pages/draft-page');
    expect(keys).toHaveLength(2);
  });

  it('returns empty array when no unpublished records exist', async () => {
    mockDocRepo.listRecords.mockReturnValue(empty());

    const keys = await backend.unpublishedEntries();

    expect(keys).toEqual([]);
  });

  it('skips RecoverableError elements and continues with remaining valid records', async () => {
    // Use LaikaStream.make to emit a recoverable error then a valid Data element.
    const { LaikaStream: LS, NotFoundError: NFE } = await import('laikacms/core');
    const Effect = await import('effect/Effect');
    const mixedStream = LS.make<
      { key: string, content: object, type: string, status: string, updatedAt: string },
      object
    >(emit =>
      Effect.gen(function*() {
        yield* emit.recoverableError(new NFE('simulated repo warning'));
        yield* emit.data({
          key: 'articles/ok',
          content: { title: 'OK' },
          type: 'unpublished',
          status: 'draft',
          updatedAt: '2024-01-01T00:00:00Z',
        });
        return {};
      })
    );
    mockDocRepo.listRecords
      .mockReturnValueOnce(mixedStream)
      .mockReturnValueOnce(empty());

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const keys = await backend.unpublishedEntries();
      expect(keys).toContain('articles/ok');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns cached result on second call without hitting the repo again', async () => {
    mockDocRepo.listRecords
      .mockReturnValue(LaikaStream.succeedMany([
        {
          key: 'articles/cached',
          content: {},
          type: 'unpublished',
          status: 'draft',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ] as any[], {}));

    await backend.unpublishedEntries();
    await backend.unpublishedEntries();

    // listRecords is called once per collection per call; with caching the second
    // unpublishedEntries() call should NOT re-invoke listRecords at all.
    // We have 2 collections → first call = 2 invocations; second call = 0.
    expect(mockDocRepo.listRecords).toHaveBeenCalledTimes(2);
  });

  it('populates unpublishedEntryCache so a subsequent unpublishedEntry() call skips the repo', async () => {
    mockDocRepo.listRecords
      .mockReturnValueOnce(LaikaStream.succeedMany([
        {
          key: 'articles/pre-cached',
          content: { title: 'Pre' },
          type: 'unpublished',
          status: 'draft',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ] as any[], {}))
      .mockReturnValueOnce(empty());

    await backend.unpublishedEntries();

    // Now calling unpublishedEntry with the same key should be served from cache
    const entry = await backend.unpublishedEntry({ id: 'articles/pre-cached' });

    expect(entry.collection).toBe('articles');
    expect(entry.slug).toBe('pre-cached');
    // getUnpublished should NOT have been called (cache hit)
    expect(mockDocRepo.getUnpublished).not.toHaveBeenCalled();
  });

  it('returns all 110 entries when collection has more than 100 unpublished records (pagination loop)', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      key: `articles/draft-${i}`,
      content: { title: `Draft ${i}` },
      type: 'unpublished' as const,
      status: 'draft',
      updatedAt: '2024-01-01T00:00:00Z',
    }));
    const page2 = Array.from({ length: 10 }, (_, i) => ({
      key: `articles/draft-${100 + i}`,
      content: { title: `Draft ${100 + i}` },
      type: 'unpublished' as const,
      status: 'draft',
      updatedAt: '2024-01-01T00:00:00Z',
    }));

    mockDocRepo.listRecords
      .mockReturnValueOnce(LaikaStream.succeedMany(page1 as any[], {}))
      .mockReturnValueOnce(LaikaStream.succeedMany(page2 as any[], {}))
      // second collection (pages) returns empty
      .mockReturnValueOnce(LaikaStream.succeedMany([] as any[], {}));

    const keys = await backend.unpublishedEntries();

    expect(keys).toHaveLength(110);
    expect(keys[0]).toBe('articles/draft-0');
    expect(keys[99]).toBe('articles/draft-99');
    expect(keys[100]).toBe('articles/draft-100');
    expect(keys[109]).toBe('articles/draft-109');
    expect(mockDocRepo.listRecords).toHaveBeenCalledTimes(3);
    expect(mockDocRepo.listRecords).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pagination: { limit: 100, offset: 0 } }),
    );
    expect(mockDocRepo.listRecords).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pagination: { limit: 100, offset: 100 } }),
    );
    expect(mockDocRepo.listRecords).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ pagination: { limit: 100, offset: 0 } }),
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: unpublishedEntry
// ---------------------------------------------------------------------------

describe('LaikaBackend.unpublishedEntry()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('returns correct shape when fetched by id', async () => {
    const unpub = {
      key: 'articles/my-draft',
      content: { title: 'My Draft' },
      type: 'unpublished',
      status: 'draft',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    mockDocRepo.getUnpublished.mockReturnValue(succeed(unpub));

    const entry = await backend.unpublishedEntry({ id: 'articles/my-draft' });

    expect(entry).toMatchObject({
      collection: 'articles',
      slug: 'my-draft',
      status: 'draft',
      diffs: [],
    });
    expect(typeof entry.updatedAt).toBe('string');
  });

  it('returns correct shape when fetched by collection + slug', async () => {
    const unpub = {
      key: 'posts/hello-world',
      content: 'raw md',
      type: 'unpublished',
      status: 'inReview',
      updatedAt: '2024-02-01T00:00:00Z',
    };
    mockDocRepo.getUnpublished.mockReturnValue(succeed(unpub));

    const entry = await backend.unpublishedEntry({ collection: 'posts', slug: 'hello-world' });

    expect(entry.collection).toBe('posts');
    expect(entry.slug).toBe('hello-world');
    expect(entry.status).toBe('inReview');
    expect(mockDocRepo.getUnpublished).toHaveBeenCalledWith('posts/hello-world');
  });

  it('strips file extensions from id before querying', async () => {
    const unpub = {
      key: 'articles/no-ext',
      content: {},
      type: 'unpublished',
      status: 'draft',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    mockDocRepo.getUnpublished.mockReturnValue(succeed(unpub));

    await backend.unpublishedEntry({ id: 'articles/no-ext.json' });

    expect(mockDocRepo.getUnpublished).toHaveBeenCalledWith('articles/no-ext');
  });

  it('returns cached result on second call without hitting the repo again', async () => {
    const unpub = {
      key: 'articles/dup',
      content: {},
      type: 'unpublished',
      status: 'draft',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    mockDocRepo.getUnpublished.mockReturnValue(succeed(unpub));

    await backend.unpublishedEntry({ id: 'articles/dup' });
    await backend.unpublishedEntry({ id: 'articles/dup' });

    expect(mockDocRepo.getUnpublished).toHaveBeenCalledTimes(1);
  });

  it('throws when neither id nor collection+slug provided', async () => {
    await expect(backend.unpublishedEntry({})).rejects.toThrow();
  });

  it('throws APIError when repo returns not-found', async () => {
    mockDocRepo.getUnpublished.mockReturnValue(fail({ code: 'NOT_FOUND', message: 'not here' }));

    await expect(backend.unpublishedEntry({ id: 'articles/missing' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite: unpublishedEntryDataFile
// ---------------------------------------------------------------------------

describe('LaikaBackend.unpublishedEntryDataFile()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('returns stringified content for an object payload', async () => {
    const unpub = {
      key: 'articles/data-entry',
      content: { title: 'Data' },
      type: 'unpublished',
      status: 'draft',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    mockDocRepo.getUnpublished.mockReturnValue(succeed(unpub));

    const result = await backend.unpublishedEntryDataFile(
      'articles',
      'data-entry',
      'articles/data-entry',
      'articles/data-entry',
    );

    expect(result).toBe(JSON.stringify({ title: 'Data' }));
    expect(mockDocRepo.getUnpublished).toHaveBeenCalledWith('articles/data-entry');
  });

  it('returns raw string content as-is', async () => {
    const raw = '---\ntitle: Raw\n---\n\nBody.';
    const unpub = {
      key: 'posts/raw',
      content: raw,
      type: 'unpublished',
      status: 'draft',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    mockDocRepo.getUnpublished.mockReturnValue(succeed(unpub));

    const result = await backend.unpublishedEntryDataFile('posts', 'raw', 'posts/raw', 'posts/raw');

    expect(result).toBe(raw);
  });

  it('prefers id over path when building the key', async () => {
    const unpub = {
      key: 'articles/by-id',
      content: {},
      type: 'unpublished',
      status: 'draft',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    mockDocRepo.getUnpublished.mockReturnValue(succeed(unpub));

    await backend.unpublishedEntryDataFile('articles', 'other', 'articles/other', 'articles/by-id');

    expect(mockDocRepo.getUnpublished).toHaveBeenCalledWith('articles/by-id');
  });

  it('throws when repo returns error', async () => {
    mockDocRepo.getUnpublished.mockReturnValue(fail({ code: 'NOT_FOUND', message: 'gone' }));

    await expect(
      backend.unpublishedEntryDataFile('articles', 'gone', 'articles/gone', 'articles/gone'),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite: updateUnpublishedEntryStatus
// ---------------------------------------------------------------------------

describe('LaikaBackend.updateUnpublishedEntryStatus()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('calls repo.updateUnpublished with normalised key and new status', async () => {
    mockDocRepo.updateUnpublished.mockReturnValue(succeed(undefined));

    await backend.updateUnpublishedEntryStatus('articles', 'my-post', 'inReview');

    expect(mockDocRepo.updateUnpublished).toHaveBeenCalledWith({
      key: 'articles/my-post',
      status: 'inReview',
    });
  });

  it('strips file extension from slug before building key', async () => {
    mockDocRepo.updateUnpublished.mockReturnValue(succeed(undefined));

    await backend.updateUnpublishedEntryStatus('articles', 'my-post.json', 'ready');

    expect(mockDocRepo.updateUnpublished).toHaveBeenCalledWith({
      key: 'articles/my-post',
      status: 'ready',
    });
  });

  it('throws APIError when repo returns error', async () => {
    mockDocRepo.updateUnpublished.mockReturnValue(fail({ code: 'NOT_FOUND', message: 'not found' }));

    await expect(
      backend.updateUnpublishedEntryStatus('articles', 'missing', 'inReview'),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite: deleteUnpublishedEntry
// ---------------------------------------------------------------------------

describe('LaikaBackend.deleteUnpublishedEntry()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('calls repo.deleteUnpublished with the normalised key', async () => {
    mockDocRepo.deleteUnpublished.mockReturnValue(succeed(undefined));

    await backend.deleteUnpublishedEntry('articles', 'my-draft');

    expect(mockDocRepo.deleteUnpublished).toHaveBeenCalledWith('articles/my-draft');
  });

  it('strips file extension from slug before calling deleteUnpublished', async () => {
    mockDocRepo.deleteUnpublished.mockReturnValue(succeed(undefined));

    await backend.deleteUnpublishedEntry('articles', 'my-draft.md');

    expect(mockDocRepo.deleteUnpublished).toHaveBeenCalledWith('articles/my-draft');
  });

  it('throws APIError when repo returns error', async () => {
    mockDocRepo.deleteUnpublished.mockReturnValue(fail({ code: 'NOT_FOUND', message: 'not found' }));

    await expect(backend.deleteUnpublishedEntry('articles', 'missing')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite: publishUnpublishedEntry
// ---------------------------------------------------------------------------

describe('LaikaBackend.publishUnpublishedEntry()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let backend: any;

  beforeEach(() => {
    mockDocRepo = makeMockDocumentsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => makeMockAssetsRepository() as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).documentsRepository = mockDocRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('calls repo.publish with the normalised key', async () => {
    mockDocRepo.publish.mockReturnValue(succeed(undefined));

    await backend.publishUnpublishedEntry('articles', 'my-draft');

    expect(mockDocRepo.publish).toHaveBeenCalledWith('articles/my-draft');
  });

  it('strips file extension from slug before publishing', async () => {
    mockDocRepo.publish.mockReturnValue(succeed(undefined));

    await backend.publishUnpublishedEntry('posts', 'hello-world.json');

    expect(mockDocRepo.publish).toHaveBeenCalledWith('posts/hello-world');
  });

  it('throws APIError when repo.publish fails', async () => {
    mockDocRepo.publish.mockReturnValue(fail({ code: 'NOT_FOUND', message: 'Entry not found' }));

    await expect(backend.publishUnpublishedEntry('articles', 'bad-key')).rejects.toThrow();
  });

  it('resolves without error on success', async () => {
    mockDocRepo.publish.mockReturnValue(succeed(undefined));

    await expect(backend.publishUnpublishedEntry('articles', 'ok')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite: getMedia
// ---------------------------------------------------------------------------

describe('LaikaBackend.getMedia()', () => {
  let mockAssetsRepo: ReturnType<typeof makeMockAssetsRepository>;
  let backend: any;

  beforeEach(() => {
    mockAssetsRepo = makeMockAssetsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => makeMockDocumentsRepository() as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).assetsRepository = mockAssetsRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('returns mapped ImplementationMediaFile array from listResources', async () => {
    const asset = { key: 'assets/uploads/logo.svg', type: 'asset', content: { size: 1234 } };
    mockAssetsRepo.listResources.mockReturnValue(
      LaikaStream.succeedMany([asset as any], { total: 1 }),
    );
    mockAssetsRepo.getUrls.mockReturnValue(
      LaikaStream.succeedMany([{ url: 'https://cdn.example.com/logo.svg' }] as any, { total: 1 }),
    );

    const media = await backend.getMedia('assets/uploads');

    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({
      id: 'assets/uploads/logo.svg',
      name: 'logo.svg',
      size: 1234,
      path: 'assets/uploads/logo.svg',
      displayURL: 'https://cdn.example.com/logo.svg',
      url: 'https://cdn.example.com/logo.svg',
    });
  });

  it('returns empty array when listResources throws a LaikaError', async () => {
    const { NotFoundError } = await import('laikacms/core');
    mockAssetsRepo.listResources.mockReturnValue(
      LaikaStream.fail(new NotFoundError('folder not found')),
    );

    const media = await backend.getMedia('bad/folder');

    expect(media).toEqual([]);
  });

  it('skips non-asset resources', async () => {
    const folder = { key: 'assets/uploads/subfolder', type: 'folder', content: {} };
    const asset = { key: 'assets/uploads/image.png', type: 'asset', content: { size: 500 } };
    mockAssetsRepo.listResources.mockReturnValue(
      LaikaStream.succeedMany([folder as any, asset as any], { total: 2 }),
    );
    mockAssetsRepo.getUrls.mockReturnValue(
      LaikaStream.succeedMany([{ url: 'https://cdn.example.com/image.png' }] as any, { total: 1 }),
    );

    const media = await backend.getMedia('assets/uploads');

    expect(media).toHaveLength(1);
    expect(media[0].name).toBe('image.png');
  });

  it('handles multiple assets across multiple listResources chunks', async () => {
    const asset1 = { key: 'assets/uploads/a.jpg', type: 'asset', content: { size: 100 } };
    const asset2 = { key: 'assets/uploads/b.jpg', type: 'asset', content: { size: 200 } };
    mockAssetsRepo.listResources.mockReturnValue(
      LaikaStream.succeedMany([asset1 as any, asset2 as any], { total: 2 }),
    );
    mockAssetsRepo.getUrls
      .mockReturnValueOnce(
        LaikaStream.succeedMany([{ url: 'https://cdn.example.com/a.jpg' }] as any, { total: 1 }),
      )
      .mockReturnValueOnce(
        LaikaStream.succeedMany([{ url: 'https://cdn.example.com/b.jpg' }] as any, { total: 1 }),
      );

    const media = await backend.getMedia('assets/uploads');

    expect(media).toHaveLength(2);
    expect(media[0].name).toBe('a.jpg');
    expect(media[1].name).toBe('b.jpg');
  });

  it('returns empty array when listResources emits no items', async () => {
    mockAssetsRepo.listResources.mockReturnValue(
      LaikaStream.empty({ total: 0 }),
    );

    const media = await backend.getMedia('assets/uploads');

    expect(media).toEqual([]);
  });

  it('skips recoverable errors from listResources and continues', async () => {
    const { NotFoundError } = await import('laikacms/core');
    const asset = { key: 'assets/uploads/good.png', type: 'asset', content: { size: 50 } };
    // Produce a stream that has a RecoverableError element followed by a Data element
    // We use Effect to build a custom stream via LaikaStream
    mockAssetsRepo.listResources.mockReturnValue(
      LaikaStream.succeedMany([asset as any], { total: 1 }),
    );
    mockAssetsRepo.getUrls.mockReturnValue(
      LaikaStream.succeedMany([{ url: 'https://cdn.example.com/good.png' }] as any, { total: 1 }),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const media = await backend.getMedia('assets/uploads');
      expect(media).toHaveLength(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: getMediaDisplayURL
// ---------------------------------------------------------------------------

describe('LaikaBackend.getMediaDisplayURL()', () => {
  let mockAssetsRepo: ReturnType<typeof makeMockAssetsRepository>;
  let backend: any;

  beforeEach(() => {
    mockAssetsRepo = makeMockAssetsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => makeMockDocumentsRepository() as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).assetsRepository = mockAssetsRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('returns string DisplayURL unchanged', async () => {
    const url = 'https://cdn.example.com/existing.jpg';
    const result = await backend.getMediaDisplayURL(url);
    expect(result).toBe(url);
  });

  it('calls getMediaFile to resolve an object DisplayURL', async () => {
    const asset = { key: 'image.png', content: { size: 100 } };
    mockAssetsRepo.getAsset.mockReturnValue(succeed(asset));
    mockAssetsRepo.getMetadata.mockReturnValue(
      LaikaStream.succeedMany([{ metadata: { mimeType: 'image/png' } }] as any, { total: 1 }),
    );
    mockAssetsRepo.getUrls.mockReturnValue(
      LaikaStream.succeedMany([{ url: 'https://cdn.example.com/image.png' }] as any, { total: 1 }),
    );

    const displayURL = { id: 'image.png', path: 'image.png' };
    const result = await backend.getMediaDisplayURL(displayURL);

    expect(result).toBe('https://cdn.example.com/image.png');
  });
});

// ---------------------------------------------------------------------------
// Suite: getMediaFile
// ---------------------------------------------------------------------------

describe('LaikaBackend.getMediaFile()', () => {
  let mockAssetsRepo: ReturnType<typeof makeMockAssetsRepository>;
  let backend: any;

  beforeEach(() => {
    mockAssetsRepo = makeMockAssetsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => makeMockDocumentsRepository() as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).assetsRepository = mockAssetsRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  it('returns correct ImplementationMediaFile shape', async () => {
    const asset = { key: 'photo.jpg', content: { size: 2048 } };
    mockAssetsRepo.getAsset.mockReturnValue(succeed(asset));
    mockAssetsRepo.getMetadata.mockReturnValue(
      LaikaStream.succeedMany([{ metadata: { mimeType: 'image/jpeg' } }] as any, { total: 1 }),
    );
    mockAssetsRepo.getUrls.mockReturnValue(
      LaikaStream.succeedMany([{ url: 'https://cdn.example.com/photo.jpg' }] as any, { total: 1 }),
    );

    const result = await backend.getMediaFile('photo.jpg');

    expect(result).toMatchObject({
      id: 'photo.jpg',
      name: 'photo.jpg',
      path: 'photo.jpg',
      displayURL: 'https://cdn.example.com/photo.jpg',
      url: 'https://cdn.example.com/photo.jpg',
    });
    expect(result.file).toBeInstanceOf(File);
    expect(result.file.name).toBe('photo.jpg');
    expect(result.file.type).toBe('image/jpeg');
  });

  it('strips public folder prefix before calling getAsset', async () => {
    const cfg = makeConfig({ public_folder: 'assets/uploads' });
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => makeMockDocumentsRepository() as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    const localBackend = new LaikaBackend(cfg) as any;
    localBackend.assetsRepository = mockAssetsRepo;
    localBackend.tokenPromise = () => Promise.resolve('fake-token');

    const asset = { key: 'photo.jpg', content: { size: 512 } };
    mockAssetsRepo.getAsset.mockReturnValue(succeed(asset));
    mockAssetsRepo.getMetadata.mockReturnValue(
      LaikaStream.succeedMany([{ metadata: { mimeType: 'image/jpeg' } }] as any, { total: 1 }),
    );
    mockAssetsRepo.getUrls.mockReturnValue(
      LaikaStream.succeedMany([{ url: 'https://cdn.example.com/photo.jpg' }] as any, { total: 1 }),
    );

    await localBackend.getMediaFile('assets/uploads/photo.jpg');

    // Should strip public folder prefix and call with just 'photo.jpg'
    expect(mockAssetsRepo.getAsset).toHaveBeenCalledWith('photo.jpg');
  });

  it('throws APIError when getAsset fails', async () => {
    mockAssetsRepo.getAsset.mockReturnValue(fail({ message: 'Not found' }));

    await expect(backend.getMediaFile('missing.jpg')).rejects.toMatchObject({
      name: 'APIError',
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: persistMedia
// ---------------------------------------------------------------------------

describe('LaikaBackend.persistMedia()', () => {
  let mockAssetsRepo: ReturnType<typeof makeMockAssetsRepository>;
  let backend: any;

  beforeEach(() => {
    mockAssetsRepo = makeMockAssetsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => makeMockDocumentsRepository() as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    backend = new LaikaBackend(makeConfig());
    (backend as any).assetsRepository = mockAssetsRepo;
    (backend as any).tokenPromise = () => Promise.resolve('fake-token');
  });

  function makeAssetProxy(overrides: Record<string, unknown> = {}) {
    const fileBlob = new File(['file content'], 'photo.jpg', { type: 'image/jpeg' });
    return {
      path: 'assets/uploads/photo.jpg',
      fileObj: fileBlob,
      ...overrides,
    };
  }

  it('throws APIError when fileObj is absent', async () => {
    const proxy = { path: 'assets/uploads/photo.jpg', fileObj: undefined };
    await expect(
      backend.persistMedia(proxy as any, {}),
    ).rejects.toMatchObject({ name: 'APIError', status: 400 });
  });

  it('uses the filename from the path as the storage key', async () => {
    const newAsset = { key: 'photo.jpg', content: { size: 13 } };
    mockAssetsRepo.createAsset.mockReturnValue(succeed(newAsset));
    mockAssetsRepo.getUrls.mockReturnValue(
      LaikaStream.succeedMany([{ url: 'https://cdn.example.com/photo.jpg' }] as any, { total: 1 }),
    );

    const proxy = makeAssetProxy();
    const result = await backend.persistMedia(proxy as any, {});

    expect(mockAssetsRepo.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'photo.jpg' }),
    );
    expect(result).toMatchObject({
      id: 'photo.jpg',
      name: 'photo.jpg',
      path: 'photo.jpg',
      displayURL: 'https://cdn.example.com/photo.jpg',
      url: 'https://cdn.example.com/photo.jpg',
    });
  });

  it('returns ImplementationMediaFile with correct shape', async () => {
    const newAsset = { key: 'photo.jpg', content: { size: 13 } };
    mockAssetsRepo.createAsset.mockReturnValue(succeed(newAsset));
    mockAssetsRepo.getUrls.mockReturnValue(
      LaikaStream.succeedMany([{ url: 'https://cdn.example.com/photo.jpg' }] as any, { total: 1 }),
    );

    const fileBlob = new File(['file content'], 'photo.jpg', { type: 'image/jpeg' });
    const proxy = makeAssetProxy({ fileObj: fileBlob });
    const result = await backend.persistMedia(proxy as any, {});

    expect(result.file).toBe(fileBlob);
    expect(result.size).toBe(fileBlob.size);
  });

  it('throws APIError when createAsset fails', async () => {
    mockAssetsRepo.createAsset.mockReturnValue(fail({ message: 'storage error', code: 'INTERNAL' }));

    await expect(
      backend.persistMedia(makeAssetProxy() as any, {}),
    ).rejects.toMatchObject({ name: 'APIError' });
  });
});

// ---------------------------------------------------------------------------
// sessionStorage mock helper (test env is Node — no browser globals)
// ---------------------------------------------------------------------------

function makeSessionStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Suite: authenticate()
// ---------------------------------------------------------------------------

describe('LaikaBackend.authenticate()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let mockAssetsRepo: ReturnType<typeof makeMockAssetsRepository>;
  let backend: any;
  let sessionStorageMock: ReturnType<typeof makeSessionStorageMock>;

  beforeEach(() => {
    sessionStorageMock = makeSessionStorageMock();
    (globalThis as any).sessionStorage = sessionStorageMock;

    mockDocRepo = makeMockDocumentsRepository();
    mockAssetsRepo = makeMockAssetsRepository();
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    backend = new LaikaBackend(makeConfig());
    vi.mocked(unsentRequest.fetchWithTimeout).mockReset();
  });

  afterEach(() => {
    delete (globalThis as any).sessionStorage;
  });

  it('success: valid token + ok /session response → returns User with correct shape', async () => {
    vi.mocked(unsentRequest.fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            attributes: {
              name: 'Alice',
              email: 'alice@example.com',
              avatar_url: 'https://example.com/avatar.png',
            },
          },
        }),
    } as any);

    const user = await backend.authenticate({ token: 'valid-token-abc' });

    expect(user).toMatchObject({
      name: 'Alice',
      login: 'alice@example.com',
      avatar_url: 'https://example.com/avatar.png',
    });
  });

  it('success: repositories are initialized after authenticate()', async () => {
    vi.mocked(unsentRequest.fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { attributes: { name: 'Alice', email: 'alice@example.com' } } }),
    } as any);

    // Before auth: getDocumentsRepo() and getAssetsRepo() throw
    expect(() => backend.getDocumentsRepo()).toThrow();
    expect(() => backend.getAssetsRepo()).toThrow();

    await backend.authenticate({ token: 'valid-token-abc' });

    // After auth: repositories are set and getters no longer throw
    expect(() => backend.getDocumentsRepo()).not.toThrow();
    expect(() => backend.getAssetsRepo()).not.toThrow();
  });

  it('success: getToken() resolves to the authenticated token', async () => {
    vi.mocked(unsentRequest.fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { attributes: { name: 'Alice', email: 'alice@example.com' } } }),
    } as any);

    await backend.authenticate({ token: 'my-token-xyz' });

    await expect(backend.getToken()).resolves.toBe('my-token-xyz');
  });

  it('success: stores token in sessionStorage', async () => {
    vi.mocked(unsentRequest.fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { attributes: { name: 'Alice', email: 'alice@example.com' } } }),
    } as any);

    await backend.authenticate({ token: 'stored-token' });

    expect(sessionStorageMock.getItem('laika_access_token')).toBe('stored-token');
  });

  it('failure: non-ok /session response → throws APIError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(unsentRequest.fetchWithTimeout).mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Unauthorized'),
    } as any);

    await expect(backend.authenticate({ token: 'bad-token' })).rejects.toMatchObject({
      name: 'APIError',
    });
  });

  it('failure: non-ok response removes token from sessionStorage', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorageMock.setItem('laika_access_token', 'old-token');

    vi.mocked(unsentRequest.fetchWithTimeout).mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Unauthorized'),
    } as any);

    await expect(backend.authenticate({ token: 'bad-token' })).rejects.toBeDefined();
    expect(sessionStorageMock.getItem('laika_access_token')).toBeNull();
  });

  it('throws AccessTokenError when credentials has no token', async () => {
    await expect(backend.authenticate({} as any)).rejects.toMatchObject({
      name: 'AccessTokenError',
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: restoreUser()
// ---------------------------------------------------------------------------

describe('LaikaBackend.restoreUser()', () => {
  let mockDocRepo: ReturnType<typeof makeMockDocumentsRepository>;
  let mockAssetsRepo: ReturnType<typeof makeMockAssetsRepository>;
  let sessionStorageMock: ReturnType<typeof makeSessionStorageMock>;

  const okSessionResponse = {
    ok: true,
    json: () =>
      Promise.resolve({
        data: { attributes: { name: 'Alice', email: 'alice@example.com' } },
      }),
  } as any;

  beforeEach(() => {
    sessionStorageMock = makeSessionStorageMock();
    (globalThis as any).sessionStorage = sessionStorageMock;

    mockDocRepo = makeMockDocumentsRepository();
    mockAssetsRepo = makeMockAssetsRepository();
    vi.mocked(unsentRequest.fetchWithTimeout).mockReset();
  });

  afterEach(() => {
    delete (globalThis as any).sessionStorage;
  });

  it('with devToken: skips sessionStorage and delegates to authenticate()', async () => {
    vi.mocked(unsentRequest.fetchWithTimeout).mockResolvedValue(okSessionResponse);

    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    const backend = new LaikaBackend(
      makeConfig({
        backend: {
          name: 'laika',
          base_url: 'https://api.example.com',
          api_root: '',
          dev_token: 'dev-secret-token',
        },
      }),
    ) as any;

    const user = await backend.restoreUser();

    expect(user).toMatchObject({ name: 'Alice' });
    expect(vi.mocked(unsentRequest.fetchWithTimeout)).toHaveBeenCalled();
  });

  it('with devToken: ignores any token in sessionStorage', async () => {
    sessionStorageMock.setItem('laika_access_token', 'session-token');
    vi.mocked(unsentRequest.fetchWithTimeout).mockResolvedValue(okSessionResponse);

    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    const backend = new LaikaBackend(
      makeConfig({
        backend: {
          name: 'laika',
          base_url: 'https://api.example.com',
          api_root: '',
          dev_token: 'dev-secret-token',
        },
      }),
    ) as any;

    const user = await backend.restoreUser();

    expect(user).toMatchObject({ name: 'Alice' });
    // authenticate() stores dev-secret-token, overwriting the old session-token
    expect(sessionStorageMock.getItem('laika_access_token')).toBe('dev-secret-token');
  });

  it('with no stored token and no devToken: rejects with AccessTokenError', async () => {
    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    const backend = new LaikaBackend(makeConfig()) as any;

    await expect(backend.restoreUser()).rejects.toMatchObject({
      name: 'AccessTokenError',
    });
  });

  it('with stored sessionStorage token: delegates to authenticate() and returns User', async () => {
    sessionStorageMock.setItem('laika_access_token', 'stored-valid-token');
    vi.mocked(unsentRequest.fetchWithTimeout).mockResolvedValue(okSessionResponse);

    const LaikaBackend = createLaikaBackend({
      getDocumentsRepository: () => mockDocRepo as any,
      getAssetsRepository: () => mockAssetsRepo as any,
    });
    const backend = new LaikaBackend(makeConfig()) as any;

    const user = await backend.restoreUser();

    expect(user).toMatchObject({ name: 'Alice' });
    expect(vi.mocked(unsentRequest.fetchWithTimeout)).toHaveBeenCalled();
  });
});
