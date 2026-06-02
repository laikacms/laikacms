import type { StorageContractCase } from 'laikacms/storage/testing';

import { DropboxStorageRepository } from '../dropbox-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Dropbox HTTP API v2 mock.
//
// Two URL bases:
//   apiUrl     — metadata calls (get_metadata, list_folder, create_folder_v2, delete_v2)
//   contentUrl — content calls (upload, download)
//
// State is a Map<path, Entry> that represents the in-memory Dropbox filesystem.
// All paths are normalised to lowercase, POSIX-style, with a leading slash
// (or empty string for the root), mirroring the Dropbox path_lower convention.
// ---------------------------------------------------------------------------

const API_URL = 'https://dbx-api-mock.test/2';
const CONTENT_URL = 'https://dbx-content-mock.test/2';
const ACCESS_TOKEN = 'test-token';

interface FileEntry {
  '.tag': 'file';
  name: string;
  path_display: string;
  path_lower: string;
  id: string;
  client_modified: string;
  server_modified: string;
  rev: string;
  size: number;
}

interface FolderEntry {
  '.tag': 'folder';
  name: string;
  path_display: string;
  path_lower: string;
  id: string;
}

type Entry = FileEntry | FolderEntry;

const norm = (p: string): string => {
  // Dropbox paths must start with '/' or be empty (root).
  const cleaned = p.replace(/\/+$/, '');
  if (cleaned === '' || cleaned === '/') return '';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
};

const basename = (p: string): string => {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
};

const parent = (p: string): string => {
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '';
  return p.slice(0, idx);
};

let idCounter = 0;
const newId = () => `id:${(++idCounter).toString().padStart(16, '0')}`;
const newRev = () => `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}`;

const now = () => new Date().toISOString();

const createMockDropbox = () => {
  const store = new Map<string, Entry>(); // path_lower → Entry
  const content = new Map<string, string>(); // path_lower → raw content string

  // The root is always implicitly a folder in Dropbox; we don't store it.

  const getEntry = (path: string): Entry | null => {
    const p = norm(path).toLowerCase();
    if (p === '' || p === '/') {
      return { '.tag': 'folder', name: '', path_display: '', path_lower: '', id: 'id:root' };
    }
    return store.get(p) ?? null;
  };

  const listChildren = (folderPath: string): Entry[] => {
    const p = norm(folderPath).toLowerCase();
    const results: Entry[] = [];
    for (const [key, entry] of store) {
      const entryParent = parent(key);
      if (entryParent === p) results.push(entry);
    }
    return results;
  };

  const ensureFolder = (folderPath: string): void => {
    const p = norm(folderPath);
    if (p === '') return; // root always exists
    const key = p.toLowerCase();
    if (!store.has(key)) {
      const entry: FolderEntry = {
        '.tag': 'folder',
        name: basename(p),
        path_display: p,
        path_lower: key,
        id: newId(),
      };
      store.set(key, entry);
    }
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;

    // ── Content API (upload / download) ──────────────────────────────────────

    if (url.startsWith(CONTENT_URL)) {
      const endpoint = url.slice(CONTENT_URL.length);

      if (endpoint === '/files/download' && method === 'POST') {
        const argHeader = headers['Dropbox-API-Arg'] ?? headers['dropbox-api-arg'] ?? '{}';
        const arg = JSON.parse(argHeader) as { path: string };
        const p = norm(arg.path).toLowerCase();
        const entry = store.get(p);
        if (!entry || entry['.tag'] !== 'file') {
          return json({ error_summary: 'path/not_found/...', error: { '.tag': 'path' } }, 409);
        }
        const text = content.get(p) ?? '';
        return new Response(text, {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'dropbox-api-result': JSON.stringify(entry),
          },
        });
      }

      if (endpoint === '/files/upload' && method === 'POST') {
        const argHeader = headers['Dropbox-API-Arg'] ?? headers['dropbox-api-arg'] ?? '{}';
        const arg = JSON.parse(argHeader) as {
          path: string,
          mode: string | { '.tag': string, update?: string },
          autorename?: boolean,
          mute?: boolean,
        };
        const p = norm(arg.path);
        const pKey = p.toLowerCase();
        const mode = typeof arg.mode === 'string' ? arg.mode : arg.mode['.tag'];
        const body = (init?.body as string) ?? '';

        const existing = store.get(pKey) as FileEntry | undefined;

        if (mode === 'add' && existing) {
          return json({
            error_summary: 'path/conflict/file/...',
            error: { '.tag': 'path', path: { '.tag': 'conflict', conflict: { '.tag': 'file' } } },
          }, 409);
        }

        if (mode === 'update' && typeof arg.mode === 'object' && arg.mode['.tag'] === 'update') {
          const expectedRev = (arg.mode as { update: string }).update;
          if (existing && existing.rev !== expectedRev) {
            return json({ error_summary: 'path/conflict/...', error: { '.tag': 'path' } }, 409);
          }
        }

        // Ensure parent folder exists
        const parentPath = parent(p);
        if (parentPath !== '') ensureFolder(parentPath);

        const nowTs = now();
        const entry: FileEntry = {
          '.tag': 'file',
          name: basename(p),
          path_display: p,
          path_lower: pKey,
          id: existing?.id ?? newId(),
          client_modified: nowTs,
          server_modified: nowTs,
          rev: newRev(),
          size: body.length,
        };
        store.set(pKey, entry);
        content.set(pKey, body);
        return json(entry);
      }

      return json({ error_summary: 'other/unknown' }, 400);
    }

    // ── Metadata API ─────────────────────────────────────────────────────────

    if (url.startsWith(API_URL)) {
      const endpoint = url.slice(API_URL.length);
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      } catch {
        return json({ error_summary: 'bad_request' }, 400);
      }

      if (endpoint === '/files/get_metadata' && method === 'POST') {
        const path = String(body['path'] ?? '');
        const entry = getEntry(path);
        if (!entry) {
          return json(
            { error_summary: 'path/not_found/...', error: { '.tag': 'path', path: { '.tag': 'not_found' } } },
            409,
          );
        }
        return json(entry);
      }

      if (endpoint === '/files/list_folder' && method === 'POST') {
        const path = String(body['path'] ?? '');
        const entries = listChildren(path);
        return json({ entries, cursor: 'cursor-done', has_more: false });
      }

      if (endpoint === '/files/list_folder/continue' && method === 'POST') {
        return json({ entries: [], cursor: 'cursor-done', has_more: false });
      }

      if (endpoint === '/files/create_folder_v2' && method === 'POST') {
        const path = String(body['path'] ?? '');
        const p = norm(path);
        const pKey = p.toLowerCase();
        const existing = store.get(pKey);
        if (existing && existing['.tag'] === 'folder') {
          // Conflict — folder already exists; datasource handles this gracefully.
          return json({
            error_summary: 'path/conflict/folder/...',
            error: { '.tag': 'path', path: { '.tag': 'conflict', conflict: { '.tag': 'folder' } } },
          }, 409);
        }
        const nowTs = now();
        const entry: FolderEntry = {
          '.tag': 'folder',
          name: basename(p) || '',
          path_display: p,
          path_lower: pKey,
          id: newId(),
        };
        store.set(pKey, entry);
        return json({ metadata: entry });
      }

      if (endpoint === '/files/delete_v2' && method === 'POST') {
        const path = String(body['path'] ?? '');
        const p = norm(path);
        const pKey = p.toLowerCase();
        const existing = store.get(pKey);
        if (!existing) {
          return json(
            { error_summary: 'path/not_found/...', error: { '.tag': 'path', path: { '.tag': 'not_found' } } },
            409,
          );
        }
        store.delete(pKey);
        content.delete(pKey);
        return json({ metadata: existing });
      }

      return json({ error_summary: `other/unhandled:${endpoint}` }, 400);
    }

    return new Response('not found', { status: 404 });
  };

  return { fetchImpl };
};

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

export const dropboxContractCase: StorageContractCase = {
  name: 'DropboxStorageRepository',
  async makeRepo() {
    const { fetchImpl } = createMockDropbox();
    return new DropboxStorageRepository({
      auth: { accessToken: ACCESS_TOKEN },
      apiUrl: API_URL,
      contentUrl: CONTENT_URL,
      fetch: fetchImpl,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
