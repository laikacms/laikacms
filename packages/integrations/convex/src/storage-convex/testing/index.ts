import type { StorageContractCase } from 'laikacms/storage/testing';

import { ConvexDataSource } from '../convex-datasource.js';
import { ConvexStorageRepository } from '../convex-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Convex mock.
//
// Implements the Convex HTTP RPC envelope:
//   POST /api/query    { path: string, args: {}, format: 'json' }
//   POST /api/mutation { path: string, args: {}, format: 'json' }
//   Reply: { status: 'success', value: T } | { status: 'error', errorMessage: string }
//
// Two tables:
//   files   — keyed by (parent, name)
//   folders — keyed by path
// ---------------------------------------------------------------------------

const CONVEX_URL = 'https://convex-mock.test';

interface FileRow {
  _id: string;
  _creationTime: number;
  path: string;
  parent: string;
  name: string;
  extension: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface FolderRow {
  _id: string;
  _creationTime: number;
  path: string;
  parent: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

let idCounter = 0;
const newId = () => `id${(++idCounter).toString().padStart(10, '0')}`;

const createMockConvex = () => {
  const files = new Map<string, FileRow>(); // path → FileRow
  const filesByParentName = new Map<string, FileRow>(); // `${parent}\x00${name}` → FileRow
  const folders = new Map<string, FolderRow>(); // path → FolderRow

  const dispatch = (kind: 'query' | 'mutation', path: string, args: Record<string, unknown>): unknown => {
    switch (path) {
      // ---- Queries ----------------------------------------------------------

      case 'laika:getFile': {
        const parent = String(args['parent'] ?? '');
        const name = String(args['name'] ?? '');
        const file = filesByParentName.get(`${parent}\x00${name}`) ?? null;
        return file;
      }

      case 'laika:listChildren': {
        const parent = String(args['parent'] ?? '');
        const result: Array<
          { _id: string, type: 'file' | 'folder', path: string, parent: string, name: string, extension?: string }
        > = [];
        for (const f of files.values()) {
          if (f.parent === parent) {
            result.push({
              _id: f._id,
              type: 'file',
              path: f.path,
              parent: f.parent,
              name: f.name,
              extension: f.extension,
            });
          }
        }
        for (const fo of folders.values()) {
          if (fo.parent === parent) {
            result.push({ _id: fo._id, type: 'folder', path: fo.path, parent: fo.parent, name: fo.name });
          }
        }
        return result;
      }

      case 'laika:getFolder': {
        const folderPath = String(args['path'] ?? '');
        return folders.get(folderPath) ?? null;
      }

      case 'laika:hasDescendants': {
        const parent = String(args['parent'] ?? '');
        for (const f of files.values()) {
          if (f.parent === parent || f.parent.startsWith(`${parent}/`)) return true;
        }
        for (const fo of folders.values()) {
          if (fo.parent === parent || fo.parent.startsWith(`${parent}/`)) return true;
        }
        return false;
      }

      // ---- Mutations --------------------------------------------------------

      case 'laika:createFile': {
        const fileArgs = args as {
          path: string,
          parent: string,
          name: string,
          extension: string,
          content: string,
          createdAt: string,
          updatedAt: string,
        };
        const key = `${fileArgs.parent}\x00${fileArgs.name}`;
        if (filesByParentName.has(key)) {
          throw new Error(`already exists: ${fileArgs.path}`);
        }
        const row: FileRow = {
          _id: newId(),
          _creationTime: Date.now(),
          path: fileArgs.path,
          parent: fileArgs.parent,
          name: fileArgs.name,
          extension: fileArgs.extension,
          content: fileArgs.content,
          createdAt: fileArgs.createdAt,
          updatedAt: fileArgs.updatedAt,
        };
        files.set(fileArgs.path, row);
        filesByParentName.set(key, row);
        return row;
      }

      case 'laika:updateFile': {
        const updateArgs = args as { path: string, content: string, updatedAt: string };
        const row = files.get(updateArgs.path);
        if (!row) throw new Error(`not found: ${updateArgs.path}`);
        const updated: FileRow = { ...row, content: updateArgs.content, updatedAt: updateArgs.updatedAt };
        files.set(updateArgs.path, updated);
        filesByParentName.set(`${row.parent}\x00${row.name}`, updated);
        return updated;
      }

      case 'laika:upsertFile': {
        const upsertArgs = args as {
          path: string,
          parent: string,
          name: string,
          extension: string,
          content: string,
          createdAt: string,
          updatedAt: string,
        };
        const key = `${upsertArgs.parent}\x00${upsertArgs.name}`;
        const existing = filesByParentName.get(key);
        // Remove old path entry if the path changed.
        if (existing && existing.path !== upsertArgs.path) {
          files.delete(existing.path);
        }
        const row: FileRow = {
          _id: existing?._id ?? newId(),
          _creationTime: existing?._creationTime ?? Date.now(),
          path: upsertArgs.path,
          parent: upsertArgs.parent,
          name: upsertArgs.name,
          extension: upsertArgs.extension,
          content: upsertArgs.content,
          createdAt: upsertArgs.createdAt,
          updatedAt: upsertArgs.updatedAt,
        };
        files.set(upsertArgs.path, row);
        filesByParentName.set(key, row);
        return row;
      }

      case 'laika:removeFiles': {
        const paths = (args['paths'] as string[]) ?? [];
        const removed: string[] = [];
        const missing: string[] = [];
        for (const p of paths) {
          const row = files.get(p);
          if (!row) {
            missing.push(p);
            continue;
          }
          files.delete(p);
          filesByParentName.delete(`${row.parent}\x00${row.name}`);
          removed.push(p);
        }
        return { removed, missing };
      }

      case 'laika:upsertFolder': {
        const folderArgs = args as {
          path: string,
          parent: string,
          name: string,
          createdAt: string,
          updatedAt: string,
        };
        const existing = folders.get(folderArgs.path);
        const row: FolderRow = {
          _id: existing?._id ?? newId(),
          _creationTime: existing?._creationTime ?? Date.now(),
          path: folderArgs.path,
          parent: folderArgs.parent,
          name: folderArgs.name,
          createdAt: folderArgs.createdAt,
          updatedAt: folderArgs.updatedAt,
        };
        folders.set(folderArgs.path, row);
        return row;
      }

      default:
        throw new Error(`mock: unknown Convex function: ${path}`);
    }
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const u = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method !== 'POST') return new Response('not found', { status: 404 });

    let kind: 'query' | 'mutation';
    if (u.pathname === '/api/query') kind = 'query';
    else if (u.pathname === '/api/mutation') kind = 'mutation';
    else return new Response('not found', { status: 404 });

    const body = JSON.parse((init?.body as string) ?? '{}') as {
      path: string,
      args: Record<string, unknown>,
    };

    try {
      const value = dispatch(kind, body.path, body.args ?? {});
      return new Response(JSON.stringify({ status: 'success', value }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ status: 'error', errorMessage: (err as Error).message }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
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

export const convexContractCase: StorageContractCase = {
  name: 'ConvexStorageRepository',
  async makeRepo() {
    const { fetchImpl } = createMockConvex();
    const dataSource = new ConvexDataSource({
      url: CONVEX_URL,
      fetch: fetchImpl,
    });
    return new ConvexStorageRepository({
      dataSource,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
