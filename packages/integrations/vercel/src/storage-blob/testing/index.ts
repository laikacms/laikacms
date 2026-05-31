import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { VercelBlobDataSource } from '../vercel-blob-datasource.js';
import { VercelBlobStorageRepository } from '../vercel-blob-storage-repository.js';

const API = 'https://blob.test';
const CDN = 'https://cdn.blob.test';
const TOKEN = 'vercel_blob_rw_test';

interface StoredBlob {
  pathname: string;
  body: string;
  contentType?: string;
  uploadedAt: string;
  size: number;
}

const cdnUrlFor = (pathname: string): string => `${CDN}/${pathname}`;
const pathnameFromCdnUrl = (url: string): string | null => {
  if (!url.startsWith(`${CDN}/`)) return null;
  return url.slice(CDN.length + 1);
};

const createMockVercelBlob = () => {
  const store = new Map<string, StoredBlob>();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];

    if (url.startsWith(`${CDN}/`)) {
      if (method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const pathname = pathnameFromCdnUrl(url)!;
      const blob = store.get(pathname);
      if (!blob) return new Response('Not found', { status: 404 });
      return new Response(blob.body, {
        status: 200,
        headers: { 'content-type': blob.contentType ?? 'application/octet-stream' },
      });
    }

    if (auth !== `Bearer ${TOKEN}`) return new Response('Unauthorized', { status: 401 });

    if (method === 'PUT' && url.startsWith(`${API}/`) && !url.startsWith(`${API}/delete`)) {
      const u = new URL(url);
      const pathname = u.pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent).join('/');
      const body = init?.body;
      const text = typeof body === 'string' ? body : body instanceof Uint8Array ? new TextDecoder().decode(body) : '';
      const contentType = (init?.headers as Record<string, string> | undefined)?.['x-content-type'];
      store.set(pathname, {
        pathname,
        body: text,
        contentType,
        uploadedAt: new Date().toISOString(),
        size: text.length,
      });
      return new Response(
        JSON.stringify({ url: cdnUrlFor(pathname), pathname, contentType }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (method === 'POST' && url.startsWith(`${API}/delete`)) {
      const body = JSON.parse(init?.body as string) as { urls: string[] };
      for (const u of body.urls) {
        const pathname = pathnameFromCdnUrl(u);
        if (pathname) store.delete(pathname);
      }
      return new Response(JSON.stringify({ deleted: body.urls.length }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (method === 'GET' && url.startsWith(`${API}/`)) {
      const u = new URL(url);
      const prefix = u.searchParams.get('prefix') ?? '';
      const limit = Number(u.searchParams.get('limit') ?? '1000');
      const matched = [...store.values()].filter(b => b.pathname.startsWith(prefix));
      matched.sort((a, b) => a.pathname.localeCompare(b.pathname));
      const page = matched.slice(0, limit);
      return new Response(
        JSON.stringify({
          blobs: page.map(b => ({
            url: cdnUrlFor(b.pathname),
            pathname: b.pathname,
            size: b.size,
            uploadedAt: b.uploadedAt,
          })),
          hasMore: matched.length > limit,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response('Not found', { status: 404 });
  };

  return { store, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const vercelBlobContractCase: StorageContractCase = {
  name: 'VercelBlobStorageRepository',
  async makeRepo() {
    const mock = createMockVercelBlob();
    const ds = new VercelBlobDataSource({
      auth: { token: TOKEN },
      apiUrl: API,
      fetch: mock.fetch,
    });
    return new VercelBlobStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry() as never,
      defaultFileExtension: 'json',
    });
  },
  skip: ['createFolder'],
};
