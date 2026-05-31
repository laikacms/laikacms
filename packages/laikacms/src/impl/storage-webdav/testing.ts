import { type StorageContractCase, storageContractRegistry } from '../../domain/storage/testing/index.js';
import { jsonSerializer } from '../../serializers/storage-serializers-json/index.js';

import type { WebDavConfig } from './infrastructure/datasources/webdav-datasource.js';
import { WebDavStorageRepository } from './infrastructure/repositories/webdav-storage-repository.js';

interface MockResource {
  isCollection: boolean;
  content: string;
  ctime: Date;
  mtime: Date;
}

const ROOT_PATH = '/dav';

const segmentsOf = (path: string): string[] => path.split('/').filter(s => s.length > 0);

const encodeHref = (path: string): string => '/' + segmentsOf(path).map(encodeURIComponent).join('/');

const buildPropfindXml = (resources: Array<{ path: string, resource: MockResource }>): string => {
  const inner = resources
    .map(({ path, resource }) => `
      <d:response>
        <d:href>${encodeHref(path)}${resource.isCollection ? '/' : ''}</d:href>
        <d:propstat>
          <d:prop>
            <d:resourcetype>${resource.isCollection ? '<d:collection/>' : ''}</d:resourcetype>
            ${resource.isCollection ? '' : `<d:getcontentlength>${resource.content.length}</d:getcontentlength>`}
            <d:getlastmodified>${resource.mtime.toUTCString()}</d:getlastmodified>
            <d:creationdate>${resource.ctime.toISOString()}</d:creationdate>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${inner}</d:multistatus>`;
};

/**
 * In-memory WebDAV server, just enough of RFC 4918 to drive the repository
 * through the contract suite. Use `createMockWebDavServer()` and pass its
 * `fetch` to a `WebDavConfig`.
 */
export const createMockWebDavServer = () => {
  const store = new Map<string, MockResource>();
  store.set(ROOT_PATH, { isCollection: true, content: '', ctime: new Date(0), mtime: new Date(0) });

  const directChildrenOf = (path: string): Array<{ path: string, resource: MockResource }> => {
    const parentSegs = segmentsOf(path);
    const out: Array<{ path: string, resource: MockResource }> = [];
    for (const [otherPath, resource] of store) {
      if (otherPath === path) continue;
      const segs = segmentsOf(otherPath);
      if (segs.length !== parentSegs.length + 1) continue;
      if (parentSegs.every((seg, i) => seg === segs[i])) {
        out.push({ path: otherPath, resource });
      }
    }
    return out;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = decodeURIComponent(url.pathname);
    const method = (init?.method ?? 'GET').toUpperCase();
    const resource = store.get(path);

    if (method === 'PROPFIND') {
      if (!resource) return new Response('', { status: 404 });
      const depth = (init?.headers as Record<string, string> | undefined)?.['Depth'] ?? '0';
      const entries: Array<{ path: string, resource: MockResource }> = [{ path, resource }];
      if (depth === '1' && resource.isCollection) entries.push(...directChildrenOf(path));
      return new Response(buildPropfindXml(entries), {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      });
    }
    if (method === 'GET') {
      if (!resource || resource.isCollection) return new Response('', { status: 404 });
      return new Response(resource.content, { status: 200 });
    }
    if (method === 'PUT') {
      const parent = '/' + segmentsOf(path).slice(0, -1).join('/');
      if (!store.has(parent)) return new Response('', { status: 409 });
      const now = new Date();
      const body = typeof init?.body === 'string' ? init.body : '';
      const existing = store.get(path);
      store.set(path, {
        isCollection: false,
        content: body,
        ctime: existing?.ctime ?? now,
        mtime: now,
      });
      return new Response(null, { status: existing ? 204 : 201 });
    }
    if (method === 'DELETE') {
      if (!resource) return new Response('', { status: 404 });
      store.delete(path);
      return new Response(null, { status: 204 });
    }
    if (method === 'MKCOL') {
      if (store.has(path)) return new Response('', { status: 405 });
      const parent = '/' + segmentsOf(path).slice(0, -1).join('/');
      if (!store.has(parent)) return new Response('', { status: 409 });
      const now = new Date();
      store.set(path, { isCollection: true, content: '', ctime: now, mtime: now });
      return new Response('', { status: 201 });
    }
    return new Response('', { status: 405 });
  };

  return { store, fetch: fetchImpl, rootPath: ROOT_PATH };
};

let activeServer: ReturnType<typeof createMockWebDavServer> | null = null;

export const webDavStorageContractCase: StorageContractCase = {
  name: 'WebDavStorageRepository (in-memory WebDAV server)',
  makeRepo: async () => {
    activeServer = createMockWebDavServer();
    const config: WebDavConfig = {
      baseUrl: `http://dav.test${activeServer.rootPath}`,
      fetch: activeServer.fetch,
    };
    return new WebDavStorageRepository(config, { json: jsonSerializer }, 'json');
  },
  teardown: async () => {
    activeServer?.store.clear();
    activeServer = null;
  },
};

storageContractRegistry.push(webDavStorageContractCase);
