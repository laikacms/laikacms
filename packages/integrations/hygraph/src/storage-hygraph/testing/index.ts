import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { HygraphStorageRepository } from '../hygraph-storage-repository.js';

const ENDPOINT = 'https://mock.hygraph.test/graphql';

interface FileNode {
  id: string;
  parent: string;
  name: string;
  path: string;
  extension: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
interface FolderNode {
  id: string;
  parent: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

const createMockHygraph = () => {
  const files = new Map<string, FileNode>();
  const folders = new Map<string, FolderNode>();
  let idCounter = 0;
  const newId = (prefix: string): string => `${prefix}-${++idCounter}`;
  const now = (): string => new Date().toISOString();

  const json = (data: unknown) =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  type Vars = Record<string, unknown>;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.toString() !== ENDPOINT) return new Response('bad endpoint', { status: 404 });
    const body = JSON.parse((init?.body as string) ?? '{}') as {
      query?: string,
      variables?: Vars,
      operationName?: string,
    };
    const op = body.operationName ?? '';
    const vars = body.variables ?? {};

    switch (op) {
      case 'FindLaikaObject': {
        const names = (vars.names as string[]) ?? [];
        const hit = [...files.values()].find(f => f.parent === vars.parent && names.includes(f.name));
        return json({ laikaObjects: hit ? [hit] : [] });
      }
      case 'GetLaikaFolder': {
        const hit = [...folders.values()].find(f => f.path === vars.path);
        return json({ laikaFolders: hit ? [hit] : [] });
      }
      case 'FindLaikaFolderByParentName': {
        const hit = [...folders.values()].find(f => f.parent === vars.parent && f.name === vars.name);
        return json({ laikaFolders: hit ? [hit] : [] });
      }
      case 'ListLaikaChildren': {
        const childFiles = [...files.values()].filter(f => f.parent === vars.parent);
        const childFolders = [...folders.values()].filter(f => f.parent === vars.parent);
        return json({ laikaObjects: childFiles, laikaFolders: childFolders });
      }
      case 'CreateLaikaObject': {
        const data = vars.data as Omit<FileNode, 'id' | 'createdAt' | 'updatedAt'>;
        const id = newId('file');
        const ts = now();
        const node: FileNode = { id, ...data, createdAt: ts, updatedAt: ts };
        files.set(id, node);
        return json({ createLaikaObject: node });
      }
      case 'UpdateLaikaObject': {
        const id = vars.id as string;
        const data = vars.data as Partial<FileNode>;
        const existing = files.get(id);
        if (!existing) return new Response(JSON.stringify({ errors: [{ message: 'not found' }] }), { status: 200 });
        const updated: FileNode = { ...existing, ...data, updatedAt: now() };
        files.set(id, updated);
        return json({ updateLaikaObject: updated });
      }
      case 'DeleteLaikaObject': {
        const id = vars.id as string;
        files.delete(id);
        return json({ deleteLaikaObject: { id } });
      }
      case 'CreateLaikaFolder': {
        const data = vars.data as Omit<FolderNode, 'id' | 'createdAt' | 'updatedAt'>;
        const id = newId('folder');
        const ts = now();
        const node: FolderNode = { id, ...data, createdAt: ts, updatedAt: ts };
        folders.set(id, node);
        return json({ createLaikaFolder: node });
      }
      case 'DeleteLaikaFolder': {
        const id = vars.id as string;
        folders.delete(id);
        return json({ deleteLaikaFolder: { id } });
      }
      default:
        return new Response(JSON.stringify({ errors: [{ message: `unhandled op: ${op}` }] }), { status: 200 });
    }
  };

  return { files, folders, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const hygraphContractCase: StorageContractCase = {
  name: 'HygraphStorageRepository',
  async makeRepo() {
    const mock = createMockHygraph();
    return new HygraphStorageRepository({
      endpoint: ENDPOINT,
      auth: { token: 'hygraph-test' },
      fetch: mock.fetch,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
