import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { GoogleDriveStorageRepository } from '../drive-storage-repository.js';

const ROOT_ID = 'root';

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: string;
  createdTime: string;
  modifiedTime: string;
  version: string;
}

const createMockDrive = () => {
  const files = new Map<string, DriveItem>();
  let idCounter = 0;
  let versionCounter = 0;

  const newId = (): string => {
    idCounter += 1;
    return `id-${idCounter}`;
  };
  const newVersion = (): string => {
    versionCounter += 1;
    return String(versionCounter);
  };

  const matchesQuery = (item: DriveItem, q: string): boolean => {
    if (/trashed\s*=\s*false/i.test(q) === false) return true;
    const nameMatch = q.match(/name\s*=\s*'((?:[^'\\]|\\.)*)'/);
    if (nameMatch) {
      const wanted = nameMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      if (item.name !== wanted) return false;
    }
    const parentMatch = q.match(/'([^']+)'\s+in\s+parents/);
    if (parentMatch) {
      const wantedParent = parentMatch[1];
      if (!item.parents.includes(wantedParent)) return false;
    }
    return true;
  };

  const toResponse = (item: DriveItem) => ({
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    parents: item.parents,
    createdTime: item.createdTime,
    modifiedTime: item.modifiedTime,
    size: String(item.content.length),
    version: item.version,
  });

  const parseMultipartRelated = (body: string): { metadata: Record<string, unknown>, content: string } => {
    const boundaryMatch = body.match(/^--([^\r\n]+)\r?\n/);
    if (!boundaryMatch) throw new Error('not multipart');
    const boundary = boundaryMatch[1];
    const parts = body.split(`--${boundary}`).filter(p => p.trim() !== '' && p.trim() !== '--');
    let metadata: Record<string, unknown> = {};
    let content = '';
    // multipart/related: first part is always metadata JSON, second is content.
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const split = part.indexOf('\r\n\r\n');
      if (split === -1) continue;
      const value = part.slice(split + 4).replace(/\r\n$/, '');
      if (i === 0) {
        metadata = JSON.parse(value) as Record<string, unknown>;
      } else {
        content = value;
      }
    }
    return { metadata, content };
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    const fileMatch = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (fileMatch && method === 'GET') {
      const id = decodeURIComponent(fileMatch[1]);
      const item = files.get(id);
      if (!item) return new Response('{"error":"not found"}', { status: 404 });
      if (url.searchParams.get('alt') === 'media') {
        return new Response(item.content, { status: 200 });
      }
      return new Response(JSON.stringify(toResponse(item)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (fileMatch && method === 'DELETE') {
      const id = decodeURIComponent(fileMatch[1]);
      if (!files.has(id)) return new Response(null, { status: 404 });
      files.delete(id);
      return new Response(null, { status: 204 });
    }

    if (path === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const matched = [...files.values()].filter(item => matchesQuery(item, q));
      return new Response(
        JSON.stringify({ files: matched.map(toResponse) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (path === '/drive/v3/files' && method === 'POST') {
      const metadata = JSON.parse((init?.body as string) ?? '{}') as {
        name: string,
        mimeType: string,
        parents?: string[],
      };
      const id = newId();
      const now = new Date().toISOString();
      const item: DriveItem = {
        id,
        name: metadata.name,
        mimeType: metadata.mimeType,
        parents: metadata.parents ?? [ROOT_ID],
        content: '',
        createdTime: now,
        modifiedTime: now,
        version: newVersion(),
      };
      files.set(id, item);
      return new Response(JSON.stringify(toResponse(item)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const uploadCreateMatch = path.match(/^\/upload\/drive\/v3\/files$/);
    if (uploadCreateMatch && method === 'POST') {
      const { metadata, content } = parseMultipartRelated((init?.body as string) ?? '');
      const id = newId();
      const now = new Date().toISOString();
      const item: DriveItem = {
        id,
        name: String(metadata.name),
        mimeType: (metadata.mimeType as string) ?? 'application/octet-stream',
        parents: (metadata.parents as string[] | undefined) ?? [ROOT_ID],
        content,
        createdTime: now,
        modifiedTime: now,
        version: newVersion(),
      };
      files.set(id, item);
      return new Response(JSON.stringify(toResponse(item)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const uploadPatchMatch = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (uploadPatchMatch && method === 'PATCH') {
      const id = decodeURIComponent(uploadPatchMatch[1]);
      const item = files.get(id);
      if (!item) return new Response('{"error":"not found"}', { status: 404 });
      const body = typeof init?.body === 'string' ? init.body : '';
      const updated: DriveItem = {
        ...item,
        content: body,
        modifiedTime: new Date().toISOString(),
        version: newVersion(),
      };
      files.set(id, updated);
      return new Response(JSON.stringify(toResponse(updated)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(`{"unhandled":"${method} ${path}"}`, { status: 501 });
  };

  return { files, fetch: fetchImpl, newId, newVersion };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const googleDriveContractCase: StorageContractCase = {
  name: 'GoogleDriveStorageRepository',
  async makeRepo() {
    const drive = createMockDrive();
    return new GoogleDriveStorageRepository({
      auth: { accessToken: 'ya29.fake' },
      fetch: drive.fetch,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
