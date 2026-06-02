import type { StorageContractCase } from 'laikacms/storage/testing';

import type { B2FileVersion } from '../b2-datasource.js';
import { B2DataSource } from '../b2-datasource.js';
import { B2StorageRepository } from '../b2-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Backblaze B2 mock — stateful Map-based file store.
// Simulates the B2 native API endpoints used by B2DataSource:
//   POST /b2api/v3/b2_authorize_account
//   POST /b2api/v3/b2_get_upload_url
//   POST <uploadUrl>                     → b2_upload_file
//   POST /b2api/v3/b2_list_file_names
//   POST /b2api/v3/b2_delete_file_version
//   GET  /file/<bucket>/<name>           → download
// ---------------------------------------------------------------------------

const AUTHORIZE_URL = 'https://b2-test.backblaze.test';
const API_URL = 'https://api-test.backblaze.test';
const DOWNLOAD_URL = 'https://dl-test.backblaze.test';
const UPLOAD_URL = 'https://upload-test.backblaze.test';
const BUCKET_ID = 'test-bucket-id';
const BUCKET_NAME = 'test-bucket';
const AUTH_TOKEN = 'test-account-token';
const UPLOAD_TOKEN = 'test-upload-token';
const KEY_ID = 'test-key-id';
const APP_KEY = 'test-app-key';

const createMockB2 = () => {
  // Map from fileName → B2FileVersion (latest version only for simplicity).
  const files = new Map<string, B2FileVersion>();
  let fileIdCounter = 0;
  const newFileId = (): string => `4_z${(++fileIdCounter).toString().padStart(20, '0')}`;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    // b2_authorize_account
    if (url === `${AUTHORIZE_URL}/b2api/v3/b2_authorize_account` && method === 'POST') {
      return json({
        authorizationToken: AUTH_TOKEN,
        apiInfo: {
          storageApi: {
            apiUrl: API_URL,
            downloadUrl: DOWNLOAD_URL,
          },
        },
      });
    }

    // b2_get_upload_url
    if (url === `${API_URL}/b2api/v3/b2_get_upload_url` && method === 'POST') {
      return json({ uploadUrl: UPLOAD_URL, authorizationToken: UPLOAD_TOKEN });
    }

    // b2_upload_file (posted to the upload URL)
    if (url === UPLOAD_URL && method === 'POST') {
      const headers = init?.headers as Record<string, string> | undefined ?? {};
      const rawFileName = headers['X-Bz-File-Name'] ?? '';
      const fileName = decodeURIComponent(rawFileName);
      const contentType = headers['Content-Type'] ?? 'application/octet-stream';
      const content = typeof init?.body === 'string' ? init.body : '';
      const fileId = newFileId();
      const version: B2FileVersion = {
        fileId,
        fileName,
        contentLength: new TextEncoder().encode(content).byteLength,
        contentSha1: 'test-sha1',
        contentType,
        uploadTimestamp: Date.now(),
      };
      files.set(fileName, version);
      return json(version);
    }

    // b2_list_file_names
    if (url === `${API_URL}/b2api/v3/b2_list_file_names` && method === 'POST') {
      const body = JSON.parse(init?.body as string) as {
        prefix?: string,
        maxFileCount?: number,
        startFileName?: string,
        delimiter?: string,
      };
      const prefix = body.prefix ?? '';
      const delimiter = body.delimiter;
      const maxFileCount = body.maxFileCount ?? 100;

      let matching: B2FileVersion[] = [];

      if (delimiter) {
        // Return synthesized folder markers for the `delimiter='/'` case.
        const seenFolders = new Set<string>();
        for (const [name, version] of files) {
          if (!name.startsWith(prefix)) continue;
          const rest = name.slice(prefix.length);
          const idx = rest.indexOf(delimiter);
          if (idx === -1) {
            matching.push(version);
          } else {
            // Synthesize a folder entry ending in '/'.
            const folderName = prefix + rest.slice(0, idx + 1);
            if (!seenFolders.has(folderName)) {
              seenFolders.add(folderName);
              matching.push({
                fileId: `folder-${folderName}`,
                fileName: folderName,
                contentLength: 0,
                contentSha1: '',
                contentType: 'application/x-directory',
                uploadTimestamp: 0,
              });
            }
          }
        }
      } else {
        for (const [name, version] of files) {
          if (!name.startsWith(prefix)) continue;
          matching.push(version);
        }
      }

      matching = matching.slice(0, maxFileCount);
      return json({ files: matching, nextFileName: null });
    }

    // b2_delete_file_version
    if (url === `${API_URL}/b2api/v3/b2_delete_file_version` && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { fileName: string, fileId: string };
      const existing = files.get(body.fileName);
      if (existing && existing.fileId === body.fileId) {
        files.delete(body.fileName);
        return json({ fileId: body.fileId, fileName: body.fileName });
      }
      return json({ status: 404, code: 'not_found', message: 'file not found' }, 404);
    }

    // Download file: GET /file/<bucket>/<name>
    const dlPrefix = `${DOWNLOAD_URL}/file/${encodeURIComponent(BUCKET_NAME)}/`;
    if (url.startsWith(dlPrefix) && method === 'GET') {
      const rawName = url.slice(dlPrefix.length);
      const fileName = decodeURIComponent(rawName);
      // We don't store content in B2FileVersion, so we need to track content separately.
      // This is handled by the contentStore Map below.
      const stored = contentStore.get(fileName);
      if (stored === undefined) return new Response('not found', { status: 404 });
      return new Response(stored, { status: 200 });
    }

    return new Response(`{"error":"unhandled","url":"${url}"}`, { status: 501 });
  };

  // We need to store content separately since B2FileVersion doesn't carry it.
  const contentStore = new Map<string, string>();

  // Wrap the fetch to intercept upload and download to track content.
  const wrappedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    // Intercept uploads to capture content.
    if (url === UPLOAD_URL && method === 'POST') {
      const headers = init?.headers as Record<string, string> | undefined ?? {};
      const rawFileName = headers['X-Bz-File-Name'] ?? '';
      const fileName = decodeURIComponent(rawFileName);
      const content = typeof init?.body === 'string' ? init.body : '';
      contentStore.set(fileName, content);
    }

    // Intercept deletes to remove content.
    if (url === `${API_URL}/b2api/v3/b2_delete_file_version` && method === 'POST') {
      const body = JSON.parse(init?.body as string) as { fileName: string };
      contentStore.delete(body.fileName);
    }

    return mockFetch(input, init);
  };

  return { fetch: wrappedFetch };
};

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

// Deterministic SHA-1 shim — the real SHA-1 requires Web Crypto which may
// not be available in the test environment; we bypass verification in the mock.
const mockSubtle = {
  digest: async (_algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer> => {
    // Return a 20-byte buffer (SHA-1 size) derived from the data length.
    const hash = new Uint8Array(20);
    const bytes = new Uint8Array(data);
    for (let i = 0; i < bytes.length; i++) {
      hash[i % 20] ^= bytes[i]!;
    }
    return hash.buffer;
  },
} as unknown as SubtleCrypto;

export const backblazeContractCase: StorageContractCase = {
  name: 'B2StorageRepository',
  async makeRepo() {
    const mock = createMockB2();
    const dataSource = new B2DataSource({
      auth: { keyId: KEY_ID, applicationKey: APP_KEY },
      bucketId: BUCKET_ID,
      bucketName: BUCKET_NAME,
      authorizeUrl: AUTHORIZE_URL,
      fetch: mock.fetch,
      subtle: mockSubtle,
    });
    return new B2StorageRepository({
      dataSource,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
