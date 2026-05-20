import { createHash } from 'node:crypto';

import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { B2DataSource, type B2FileVersion, computeSha1Hex } from './b2-datasource.js';
import { B2StorageRepository } from './b2-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Backblaze B2 native API mock.
//
// Six endpoints carry the test surface:
//
//   POST <authorize>/b2api/v3/b2_authorize_account   (Basic auth)
//   POST <api>/b2api/v3/b2_get_upload_url            (account token)
//   POST <upload-url>                                 (upload token + SHA-1 hdr)
//   POST <api>/b2api/v3/b2_list_file_names            (account token)
//   POST <api>/b2api/v3/b2_delete_file_version        (account token)
//   GET  <download>/file/<bucket>/<filename>          (account token)
//
// The mock enforces the SHA-1 verification — uploads with a bad
// `X-Bz-Content-Sha1` header are rejected.
// ---------------------------------------------------------------------------

const AUTHORIZE = 'https://api.backblazeb2.test';
const API_URL = 'https://api005.backblazeb2.test';
const DOWNLOAD_URL = 'https://f005.backblazeb2.test';
const UPLOAD_URL_PREFIX = 'https://pod-005.backblazeb2.test/upload';
const KEY_ID = 'b2_key_test';
const APP_KEY = 'b2_app_test';
const ACCOUNT_TOKEN = 'b2_account_token_xyz';
const BUCKET_ID = 'bkt-laika';
const BUCKET_NAME = 'laika-bucket';

interface StoredFile {
  fileId: string;
  fileName: string;
  contentLength: number;
  contentSha1: string;
  contentType: string;
  uploadTimestamp: number;
  content: string;
}

let files: Map<string, StoredFile>;     // by fileId
let filesByName: Map<string, StoredFile[]>;  // by fileName → versions (newest first)
let fileIdCounter: number;
let activeUploadTokens: Set<string>;
let getUploadUrlCount: number;
let uploadCount: number;
let authorizeCount: number;
let lastUploadHeaders: Record<string, string> | null = null;
let lastUploadFailedSha1: boolean = false;

// SHA-1 in Node — what undici can use, and what we compare upload bodies against.
const sha1 = (s: string): string => createHash('sha1').update(s, 'utf8').digest('hex');

const nextFileId = (): string => `f${(++fileIdCounter).toString(36).padStart(10, '0')}`;
const nextUploadToken = (): string => `b2_upload_${Math.random().toString(36).slice(2, 10)}`;

const storeFile = (fileName: string, content: string, contentType: string, contentSha1: string): StoredFile => {
  const fileId = nextFileId();
  const stored: StoredFile = {
    fileId,
    fileName,
    contentLength: new TextEncoder().encode(content).byteLength,
    contentSha1,
    contentType,
    uploadTimestamp: Date.now(),
    content,
  };
  files.set(fileId, stored);
  const versions = filesByName.get(fileName) ?? [];
  versions.unshift(stored);  // newest first
  filesByName.set(fileName, versions);
  return stored;
};

const toFileVersion = (s: StoredFile): B2FileVersion => ({
  fileId: s.fileId,
  fileName: s.fileName,
  contentLength: s.contentLength,
  contentSha1: s.contentSha1,
  contentType: s.contentType,
  uploadTimestamp: s.uploadTimestamp,
});

// ---- Mock fetch ----------------------------------------------------------

const expectedBasicAuth = `Basic ${btoa(`${KEY_ID}:${APP_KEY}`)}`;

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = (init?.headers as Record<string, string> | undefined) ?? {};

  // ---- b2_authorize_account --------------------------------------------
  if (url === `${AUTHORIZE}/b2api/v3/b2_authorize_account` && method === 'POST') {
    authorizeCount += 1;
    if (headers['Authorization'] !== expectedBasicAuth) {
      return new Response(JSON.stringify({ code: 'bad_auth_token', message: 'bad credentials' }), { status: 401 });
    }
    return new Response(JSON.stringify({
      apiInfo: { storageApi: { apiUrl: API_URL, downloadUrl: DOWNLOAD_URL, bucketId: BUCKET_ID } },
      authorizationToken: ACCOUNT_TOKEN,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- b2_get_upload_url -----------------------------------------------
  if (url === `${API_URL}/b2api/v3/b2_get_upload_url` && method === 'POST') {
    getUploadUrlCount += 1;
    if (headers['Authorization'] !== ACCOUNT_TOKEN) {
      return new Response(JSON.stringify({ code: 'bad_auth_token' }), { status: 401 });
    }
    const token = nextUploadToken();
    activeUploadTokens.add(token);
    return new Response(JSON.stringify({
      uploadUrl: `${UPLOAD_URL_PREFIX}/${token}`,
      authorizationToken: token,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- <upload-url> ----------------------------------------------------
  if (url.startsWith(UPLOAD_URL_PREFIX) && method === 'POST') {
    uploadCount += 1;
    lastUploadHeaders = headers;
    const token = url.slice(UPLOAD_URL_PREFIX.length + 1);
    if (!activeUploadTokens.has(token)) {
      return new Response(JSON.stringify({ code: 'bad_auth_token' }), { status: 401 });
    }
    if (headers['Authorization'] !== token) {
      return new Response(JSON.stringify({ code: 'bad_auth_token' }), { status: 401 });
    }
    const fileName = decodeURIComponent(headers['X-Bz-File-Name'] ?? '');
    const declaredSha1 = headers['X-Bz-Content-Sha1'] ?? '';
    const contentType = headers['Content-Type'] ?? 'application/octet-stream';
    const body = init?.body as string ?? '';
    // **MANDATORY SHA-1 VERIFICATION.** B2 rejects on mismatch.
    const actualSha1 = sha1(body);
    if (declaredSha1.toLowerCase() !== actualSha1.toLowerCase()) {
      lastUploadFailedSha1 = true;
      return new Response(JSON.stringify({
        code: 'bad_request',
        message: `Content SHA-1 mismatch: declared=${declaredSha1} actual=${actualSha1}`,
      }), { status: 400 });
    }
    const stored = storeFile(fileName, body, contentType, actualSha1);
    return new Response(JSON.stringify(toFileVersion(stored)), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  // ---- b2_list_file_names ----------------------------------------------
  if (url === `${API_URL}/b2api/v3/b2_list_file_names` && method === 'POST') {
    if (headers['Authorization'] !== ACCOUNT_TOKEN) {
      return new Response(JSON.stringify({ code: 'bad_auth_token' }), { status: 401 });
    }
    const body = JSON.parse(init?.body as string) as {
      bucketId: string; prefix?: string; maxFileCount?: number; delimiter?: string;
    };
    if (body.bucketId !== BUCKET_ID) {
      return new Response(JSON.stringify({ code: 'bad_request' }), { status: 400 });
    }
    // Get the latest version of each fileName.
    const latest: StoredFile[] = [];
    for (const versions of filesByName.values()) {
      const first = versions[0];
      if (first) latest.push(first);
    }
    let matches = latest.filter(f => body.prefix === undefined || f.fileName.startsWith(body.prefix));
    // Apply `delimiter` — synthesize folder markers.
    if (body.delimiter && body.prefix !== undefined) {
      const synthesized: B2FileVersion[] = [];
      const folders = new Set<string>();
      const directFiles: StoredFile[] = [];
      for (const f of matches) {
        const tail = f.fileName.slice(body.prefix.length);
        const idx = tail.indexOf(body.delimiter);
        if (idx === -1) {
          directFiles.push(f);
        } else {
          const folderName = `${body.prefix}${tail.slice(0, idx + 1)}`;
          folders.add(folderName);
        }
      }
      synthesized.push(...directFiles.map(toFileVersion));
      for (const folderName of folders) {
        synthesized.push({
          fileId: `folder-${folderName}`,
          fileName: folderName,
          contentLength: 0,
          contentSha1: '',
          contentType: 'application/x-bz-folder',
          uploadTimestamp: 0,
        });
      }
      matches = matches.filter(f => false); // emptied; we use `synthesized` below
      const limited = synthesized.slice(0, body.maxFileCount ?? 100);
      return new Response(JSON.stringify({ files: limited, nextFileName: null }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    const limited = matches.slice(0, body.maxFileCount ?? 100);
    return new Response(JSON.stringify({
      files: limited.map(toFileVersion),
      nextFileName: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- b2_delete_file_version ------------------------------------------
  if (url === `${API_URL}/b2api/v3/b2_delete_file_version` && method === 'POST') {
    if (headers['Authorization'] !== ACCOUNT_TOKEN) {
      return new Response(JSON.stringify({ code: 'bad_auth_token' }), { status: 401 });
    }
    const { fileName, fileId } = JSON.parse(init?.body as string) as { fileName: string; fileId: string };
    const file = files.get(fileId);
    if (!file || file.fileName !== fileName) {
      return new Response(JSON.stringify({ code: 'file_not_present' }), { status: 400 });
    }
    files.delete(fileId);
    const versions = filesByName.get(fileName) ?? [];
    filesByName.set(fileName, versions.filter(v => v.fileId !== fileId));
    if (filesByName.get(fileName)?.length === 0) filesByName.delete(fileName);
    return new Response(JSON.stringify({ fileId, fileName }), { status: 200 });
  }

  // ---- GET <download>/file/<bucket>/<filename> -------------------------
  if (url.startsWith(`${DOWNLOAD_URL}/file/${BUCKET_NAME}/`) && method === 'GET') {
    if (headers['Authorization'] !== ACCOUNT_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }
    const fileName = decodeURIComponent(url.slice(`${DOWNLOAD_URL}/file/${BUCKET_NAME}/`.length));
    const versions = filesByName.get(fileName);
    if (!versions || versions.length === 0) return new Response('not found', { status: 404 });
    return new Response(versions[0]!.content, {
      status: 200,
      headers: { 'content-type': versions[0]!.contentType },
    });
  }

  return new Response(JSON.stringify({ code: 'not_found' }), { status: 404 });
};

// ---------------------------------------------------------------------------
// Serializer registry
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) =>
      String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (
  basePath?: string,
  fetchImpl: typeof fetch = mockFetch,
): B2StorageRepository => {
  const ds = new B2DataSource({
    authorizeUrl: AUTHORIZE,
    bucketId: BUCKET_ID,
    bucketName: BUCKET_NAME,
    auth: { keyId: KEY_ID, applicationKey: APP_KEY },
    fetch: fetchImpl,
    // Use Node's crypto.subtle (Web Crypto-compatible).
    subtle: globalThis.crypto.subtle,
  });
  return new B2StorageRepository({
    dataSource: ds,
    basePath,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  files = new Map();
  filesByName = new Map();
  fileIdCounter = 0;
  activeUploadTokens = new Set();
  getUploadUrlCount = 0;
  uploadCount = 0;
  authorizeCount = 0;
  lastUploadHeaders = null;
  lastUploadFailedSha1 = false;
});

afterEach(() => {
  files.clear();
  filesByName.clear();
  activeUploadTokens.clear();
});

// ---------------------------------------------------------------------------
// Helper unit tests
// ---------------------------------------------------------------------------

describe('computeSha1Hex', () => {
  it('matches Node\'s sha1 implementation', async () => {
    const hex = await computeSha1Hex('hello world');
    expect(hex).toBe('2aae6c35c94fcfb415dbe95f408b9ce91ee846ed');
  });

  it('handles empty strings', async () => {
    const hex = await computeSha1Hex('');
    expect(hex).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });
});

// ---------------------------------------------------------------------------
// Repository tests
// ---------------------------------------------------------------------------

describe('B2StorageRepository', () => {
  it('createObject + getObject round-trip uses two-phase upload + SHA-1 verification', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // fileId surfaces as revisionId.
    expect(created.metadata?.revisionId).toMatch(/^f/);

    // The two-phase upload pattern fired: one authorize + one get_upload_url + one upload.
    expect(authorizeCount).toBe(1);
    expect(getUploadUrlCount).toBe(1);
    expect(uploadCount).toBe(1);

    // The file was stored.
    const versions = filesByName.get('notes/hello.md');
    expect(versions).toHaveLength(1);
    expect(versions![0]?.content).toBe('hi');

    // Round-trip — uses the download URL.
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('upload includes X-Bz-Content-Sha1 header that matches the body', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    expect(lastUploadHeaders).toBeTruthy();
    const declaredSha1 = lastUploadHeaders!['X-Bz-Content-Sha1'];
    expect(declaredSha1).toBe(sha1('a'));
    // Sanity: the file was actually stored, meaning the mock accepted the SHA-1.
    expect(filesByName.size).toBe(1);
    expect(lastUploadFailedSha1).toBe(false);
  });

  it('upload uses bare `Authorization: <upload-token>` header (no Bearer/Token prefix)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    const auth = lastUploadHeaders!['Authorization'];
    expect(auth).toBeTruthy();
    expect(auth).not.toMatch(/^Bearer /);
    expect(auth).not.toMatch(/^Token /);
    expect(auth).not.toMatch(/^Basic /);
    // The token is one we previously issued via b2_get_upload_url.
    expect(activeUploadTokens.has(auth!)).toBe(true);
  });

  it('upload URL is distinct from the API URL (two-phase upload)', async () => {
    const repo = makeRepo();
    let uploadHostname = '';
    const sniff: typeof fetch = async (input, init) => {
      const u = typeof input === 'string' ? input : (input as URL).toString();
      if (u.startsWith(UPLOAD_URL_PREFIX)) uploadHostname = new URL(u).hostname;
      return mockFetch(input, init);
    };
    const sniffRepo = makeRepo(undefined, sniff);
    await LaikaTask.runPromise(
      sniffRepo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    expect(uploadHostname).toBe('pod-005.backblazeb2.test');
    // The upload host differs from the API host (api005.backblazeb2.test).
    expect(uploadHostname).not.toBe('api005.backblazeb2.test');
  });

  it('createObject rejects duplicates via the resolveFile probe', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('updateObject creates a new file version (B2 versioning semantics)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    // Two physical versions; the latest is what reads see.
    const versions = filesByName.get('notes/x.md');
    expect(versions).toHaveLength(2);
    // Newest first.
    expect(versions![0]?.content).toBe('b');
    expect(versions![1]?.content).toBe('a');

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(fetched.content).toEqual({ body: 'b' });
  });

  it('removeAtoms does N parallel delete_file_version calls', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // All files gone.
    expect(files.size).toBe(0);
  });

  it('removeAtoms uses the (fileName, fileId) tuple per delete', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // Sniff the delete bodies.
    const deleteBodies: Array<{ fileName: string; fileId: string }> = [];
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/b2_delete_file_version')) {
        deleteBodies.push(JSON.parse(init?.body as string));
      }
      return mockFetch(input, init);
    };
    const sniffRepo = makeRepo(undefined, sniff);
    await LaikaStream.runPromiseCollect(sniffRepo.removeAtoms(['notes/x']));
    expect(deleteBodies).toHaveLength(1);
    expect(deleteBodies[0]?.fileName).toBe('notes/x.md');
    expect(deleteBodies[0]?.fileId).toMatch(/^f/);
  });

  it('removeAtoms reports missing keys as skipped', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/nope']),
    );
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries uses b2_list_file_names with delimiter for subfolder grouping', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/sub/c', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('notes', { pagination: PAGE }),
    );
    const types = collected.data.reduce((acc, s) => {
      acc[s.key] = s.type;
      return acc;
    }, {} as Record<string, string>);
    expect(types).toEqual({
      'notes/a': 'object-summary',
      'notes/b': 'object-summary',
      'notes/sub': 'folder-summary',
    });
  });

  it('createFolder lays down a `.keep` placeholder file', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    expect(filesByName.has('empty/.keep')).toBe(true);
  });

  it('getFolder fails for a missing path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found/i);
  });

  it('basePath scopes the file names under that prefix', async () => {
    const repo = makeRepo('tenant-a');
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    expect(filesByName.has('tenant-a/notes/x.md')).toBe(true);
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(fetched.key).toBe('notes/x');
  });

  it('account auth is cached across operations (single b2_authorize_account call)', async () => {
    const repo = makeRepo();
    authorizeCount = 0;
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'c', content: { body: 'c' } }));
    // Three uploads but only ONE authorize call — the account auth was cached.
    expect(authorizeCount).toBe(1);
  });
});

// Reference unused symbols.
void getUploadUrlCount;
void uploadCount;
