/**
 * Tests for laika-backend.ts
 *
 * Strategy: We test the pure utility functions (normalizeKey, contentToRawString,
 * DedupeCache) extracted via createLaikaBackend, and the backend methods that
 * can be exercised by injecting mock DocumentsRepository / AssetsRepository
 * implementations.
 *
 * Browser-only Decap CMS packages (decap-cms-lib-util, decap-cms-lib-auth,
 * decap-cms-ui-default) are mocked because they call `window` at module load
 * time. We do NOT test the authentication flow because that requires a running
 * server.
 */

import * as Result from 'effect/Result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock browser-only deps BEFORE any import that transitively loads them
// ---------------------------------------------------------------------------

vi.mock('decap-cms-lib-util', () => ({
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
}));

vi.mock('decap-cms-lib-auth', () => ({
  PkceAuthenticator: class PkceAuthenticator {
    completeAuth = vi.fn();
    authenticate = vi.fn();
  },
}));

vi.mock('decap-cms-ui-default', () => ({
  AuthenticationPage: () => null,
  Icon: () => null,
}));

vi.mock('@laikacms/documents-jsonapi-proxy', () => ({
  DocumentsJsonApiProxyRepository: class MockDocumentsJsonApiProxyRepository {},
}));

vi.mock('@laikacms/assets-jsonapi-proxy', () => ({
  AssetsJsonApiProxyRepository: class MockAssetsJsonApiProxyRepository {},
}));

// ---------------------------------------------------------------------------
// Minimal helpers to build async generators that yield LaikaResult values
// ---------------------------------------------------------------------------

async function* succeed<T>(value: T): AsyncGenerator<Result.Result<T, any>> {
  yield Result.succeed(value);
}

async function* fail<E>(error: E): AsyncGenerator<Result.Result<any, E>> {
  yield Result.fail(error);
}

async function* empty<T>(): AsyncGenerator<Result.Result<T, any>> {
  // yields nothing
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
    async function* mockListRecords() {
      yield Result.succeed([
        { key: 'articles/a', content: { title: 'A' }, type: 'published' },
        { key: 'articles/b', content: { title: 'B' }, type: 'published' },
      ] as any[]);
    }
    mockDocRepo.listRecords.mockReturnValue(mockListRecords());

    const entries = await backend.entriesByFolder('articles', 'json', 1);

    expect(entries).toHaveLength(2);
    expect(entries[0].file.path).toBe('articles/a');
    expect(entries[1].file.path).toBe('articles/b');
  });

  it('skips records that are not published', async () => {
    async function* mockListRecords() {
      yield Result.succeed([
        { key: 'articles/pub', content: { title: 'Pub' }, type: 'published' },
        { key: 'articles/draft', content: { title: 'Draft' }, type: 'unpublished' },
      ] as any[]);
    }
    mockDocRepo.listRecords.mockReturnValue(mockListRecords());

    const entries = await backend.entriesByFolder('articles', 'json', 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].file.path).toBe('articles/pub');
  });

  it('returns empty array when generator yields no records', async () => {
    mockDocRepo.listRecords.mockReturnValue(empty());

    const entries = await backend.entriesByFolder('articles', 'json', 1);

    expect(entries).toEqual([]);
  });

  it('skips failed results and continues processing successful ones', async () => {
    async function* mockListRecords() {
      yield Result.fail({ code: 'INTERNAL_ERROR', message: 'Oops' } as any);
      yield Result.succeed([
        { key: 'articles/ok', content: { title: 'OK' }, type: 'published' },
      ] as any[]);
    }
    mockDocRepo.listRecords.mockReturnValue(mockListRecords());

    const entries = await backend.entriesByFolder('articles', 'json', 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].file.path).toBe('articles/ok');
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

  it('tries deleteUnpublished when deleteDocument yields no success', async () => {
    mockDocRepo.deleteDocument.mockImplementation(() => empty());
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
    async function* mockListRecords() {
      yield Result.succeed([
        { key: 'articles/a', content: {}, type: 'published' },
        { key: 'articles/b', content: {}, type: 'published' },
      ] as any[]);
    }
    mockDocRepo.listRecords.mockReturnValue(mockListRecords());

    const entries = await backend.allEntriesByFolder('articles', 'json', 1);
    expect(entries).toHaveLength(2);
  });

  it('filters entries by pathRegex when provided', async () => {
    async function* mockListRecords() {
      yield Result.succeed([
        { key: 'articles/alpha', content: {}, type: 'published' },
        { key: 'articles/beta', content: {}, type: 'published' },
      ] as any[]);
    }
    mockDocRepo.listRecords.mockReturnValue(mockListRecords());

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
