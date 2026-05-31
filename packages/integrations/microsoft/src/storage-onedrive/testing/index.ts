import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { OneDriveDataSource, type OneDriveItem } from '../onedrive-datasource.js';
import { OneDriveStorageRepository } from '../onedrive-storage-repository.js';

const API = 'https://graph.test/v1.0';
const CDN = 'https://cdn.test';
const TOKEN = 'graph_test_token';

interface Item {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  content?: string;
  mimeType?: string;
  parentPath: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  eTag: string;
}

const downloadUrlFor = (path: string): string => `${CDN}/dl/${encodeURIComponent(path)}`;
const pathFromDownloadUrl = (url: string): string | null => {
  if (!url.startsWith(`${CDN}/dl/`)) return null;
  return decodeURIComponent(url.slice(CDN.length + 4));
};

const itemToGraphResponse = (item: Item): OneDriveItem => ({
  id: item.id,
  name: item.name,
  parentReference: { path: item.parentPath },
  ...(item.type === 'file'
    ? {
      file: { mimeType: item.mimeType },
      '@microsoft.graph.downloadUrl': downloadUrlFor(item.path),
    }
    : { folder: { childCount: 0 } }),
  size: item.content?.length ?? 0,
  createdDateTime: item.createdDateTime,
  lastModifiedDateTime: item.lastModifiedDateTime,
  eTag: item.eTag,
});

const parseGraphUrl = (
  url: string,
): { kind: 'metadata' | 'children' | 'content' | 'create-folder' | 'batch' | 'unknown', path?: string } => {
  if (url === `${API}/$batch` || url === '/$batch') return { kind: 'batch' };
  if (!url.startsWith(`${API}/me/drive/root`) && !url.startsWith('/me/drive/root')) return { kind: 'unknown' };
  const relative = url.startsWith(API) ? url.slice(API.length) : url;
  const pathOnly = relative.split('?')[0]!;
  if (pathOnly === '/me/drive/root') return { kind: 'metadata', path: '' };
  if (pathOnly === '/me/drive/root/children') return { kind: 'children', path: '' };
  if (pathOnly === '/me/drive/root/content') return { kind: 'content', path: '' };
  const match = pathOnly.match(/^\/me\/drive\/root:\/(.+?):(\/.*)?$/);
  if (!match) return { kind: 'unknown' };
  const encodedPath = match[1]!;
  const path = encodedPath.split('/').map(decodeURIComponent).join('/');
  const suffix = match[2] ?? '';
  if (suffix === '') return { kind: 'metadata', path };
  if (suffix === '/children') return { kind: 'children', path };
  if (suffix === '/content') return { kind: 'content', path };
  return { kind: 'unknown', path };
};

interface MockResponse {
  status: number;
  body?: unknown;
}

const createMockOneDrive = () => {
  const items = new Map<string, Item>();
  let idCounter = 0;
  const nextId = (): string => {
    idCounter += 1;
    return `item${idCounter}`;
  };
  const nextETag = (): string => `"{${Math.random().toString(36).slice(2, 10)}}"`;

  const handleRequest = (method: string, url: string, body: unknown): MockResponse => {
    const parsed = parseGraphUrl(url);

    if (parsed.kind === 'metadata' && method === 'GET') {
      if (parsed.path === '') {
        return {
          status: 200,
          body: itemToGraphResponse({
            id: 'root',
            name: 'root',
            path: '',
            type: 'folder',
            parentPath: '',
            createdDateTime: new Date(0).toISOString(),
            lastModifiedDateTime: new Date(0).toISOString(),
            eTag: '"root"',
          }),
        };
      }
      const item = items.get(parsed.path!);
      if (!item) return { status: 404, body: { error: { code: 'itemNotFound' } } };
      return { status: 200, body: itemToGraphResponse(item) };
    }

    if (parsed.kind === 'metadata' && method === 'DELETE') {
      const item = items.get(parsed.path!);
      if (!item) return { status: 404, body: { error: { code: 'itemNotFound' } } };
      items.delete(parsed.path!);
      return { status: 204 };
    }

    if (parsed.kind === 'content' && method === 'PUT') {
      const conflict = url.match(/conflictBehavior=(\w+)/)?.[1] ?? 'replace';
      const existing = items.get(parsed.path!);
      if (existing && conflict === 'fail') {
        return { status: 409, body: { error: { code: 'nameAlreadyExists', message: 'File already exists' } } };
      }
      const name = parsed.path!.includes('/') ? parsed.path!.slice(parsed.path!.lastIndexOf('/') + 1) : parsed.path!;
      const parentPath = parsed.path!.includes('/') ? parsed.path!.slice(0, parsed.path!.lastIndexOf('/')) : '';
      const now = new Date().toISOString();
      const item: Item = {
        id: existing?.id ?? nextId(),
        name,
        path: parsed.path!,
        type: 'file',
        content: typeof body === 'string' ? body : '',
        mimeType: 'application/octet-stream',
        parentPath,
        createdDateTime: existing?.createdDateTime ?? now,
        lastModifiedDateTime: now,
        eTag: nextETag(),
      };
      items.set(parsed.path!, item);
      return { status: existing ? 200 : 201, body: itemToGraphResponse(item) };
    }

    if (parsed.kind === 'children' && method === 'GET') {
      const parent = parsed.path!;
      const children = [...items.values()].filter(it => it.parentPath === parent);
      return { status: 200, body: { value: children.map(itemToGraphResponse) } };
    }

    if (parsed.kind === 'children' && method === 'POST') {
      const folderBody = body as { name?: string, folder?: unknown, '@microsoft.graph.conflictBehavior'?: string };
      const parent = parsed.path!;
      const name = folderBody.name!;
      const fullPath = parent === '' ? name : `${parent}/${name}`;
      if (items.has(fullPath) && folderBody['@microsoft.graph.conflictBehavior'] === 'fail') {
        return { status: 409, body: { error: { code: 'nameAlreadyExists', message: 'Folder already exists' } } };
      }
      const now = new Date().toISOString();
      const item: Item = {
        id: nextId(),
        name,
        path: fullPath,
        type: 'folder',
        parentPath: parent,
        createdDateTime: now,
        lastModifiedDateTime: now,
        eTag: nextETag(),
      };
      items.set(fullPath, item);
      return { status: 201, body: itemToGraphResponse(item) };
    }

    return { status: 404, body: { error: { code: 'itemNotFound', message: `mock: no route for ${method} ${url}` } } };
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.startsWith(`${CDN}/dl/`)) {
      if (method !== 'GET') return new Response('method not allowed', { status: 405 });
      const path = pathFromDownloadUrl(url)!;
      const item = items.get(path);
      if (!item || item.type !== 'file') return new Response('not found', { status: 404 });
      return new Response(item.content ?? '', {
        status: 200,
        headers: { 'content-type': item.mimeType ?? 'application/octet-stream' },
      });
    }

    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    if (auth !== `Bearer ${TOKEN}`) return new Response('Unauthorized', { status: 401 });

    if (url === `${API}/$batch` && method === 'POST') {
      const batchBody = JSON.parse(init?.body as string) as {
        requests: Array<{ id: string, method: string, url: string, body?: unknown }>,
      };
      const responses = batchBody.requests.map(req => {
        const result = handleRequest(req.method.toUpperCase(), req.url, req.body);
        return { id: req.id, status: result.status, body: result.body };
      });
      return new Response(JSON.stringify({ responses }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // For PUT /content requests the body is raw file content (text); for
    // POST /children it is JSON. Detect by whether the URL path ends in /content.
    let parsedBody: unknown = undefined;
    if (init?.body) {
      const isContentUpload = url.includes(':/content');
      if (isContentUpload) {
        parsedBody = typeof init.body === 'string' ? init.body : String(init.body);
      } else if (typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      } else {
        parsedBody = init.body;
      }
    }
    const result = handleRequest(method, url, parsedBody);
    return new Response(
      result.body !== undefined ? JSON.stringify(result.body) : null,
      { status: result.status, headers: { 'content-type': 'application/json' } },
    );
  };

  return { items, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const oneDriveContractCase: StorageContractCase = {
  name: 'OneDriveStorageRepository',
  async makeRepo() {
    const backend = createMockOneDrive();
    const ds = new OneDriveDataSource({
      auth: { accessToken: TOKEN },
      apiUrl: API,
      fetch: backend.fetch,
    });
    return new OneDriveStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
