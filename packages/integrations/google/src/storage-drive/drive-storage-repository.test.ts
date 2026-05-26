import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FOLDER_MIME_TYPE } from './drive-datasource.js';
import { GoogleDriveStorageRepository } from './drive-storage-repository.js';

// ---------------------------------------------------------------------------
// Tiny in-memory Drive — just enough of the REST v3 surface to drive the
// repository: file get (meta + media), search by `q=`, multipart upload,
// media-only PATCH, metadata POST (for folders), and DELETE.
// ---------------------------------------------------------------------------

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

const ROOT_ID = 'root';

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

  /** Parse the subset of Drive's `q=` syntax we emit. */
  const matchesQuery = (item: DriveItem, q: string): boolean => {
    if (/trashed\s*=\s*false/i.test(q) === false) return true; // unsupported in tests
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
    for (const part of parts) {
      const split = part.indexOf('\r\n\r\n');
      if (split === -1) continue;
      const headers = part.slice(0, split);
      const value = part.slice(split + 4).replace(/\r\n$/, '');
      if (/Content-Type:\s*application\/json/i.test(headers)) {
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

    // --- Single-file metadata or media GET ----------------------------------
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

    // --- Search / list ------------------------------------------------------
    if (path === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const matched = [...files.values()].filter(item => matchesQuery(item, q));
      return new Response(
        JSON.stringify({ files: matched.map(toResponse) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // --- Create folder (or other metadata-only file) ------------------------
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

    // --- Multipart upload (POST) -------------------------------------------
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

    // --- Media PATCH (replace content) -------------------------------------
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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let drive: ReturnType<typeof createMockDrive>;

beforeEach(() => {
  drive = createMockDrive();
});
afterEach(() => {
  drive.files.clear();
});

const makeRepo = () =>
  new GoogleDriveStorageRepository({
    auth: { accessToken: 'ya29.fake' },
    fetch: drive.fetch,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

const seedFolder = (name: string, parentId = ROOT_ID): string => {
  const id = drive.newId();
  drive.files.set(id, {
    id,
    name,
    mimeType: FOLDER_MIME_TYPE,
    parents: [parentId],
    content: '',
    createdTime: new Date('2026-05-01').toISOString(),
    modifiedTime: new Date('2026-05-01').toISOString(),
    version: '1',
  });
  return id;
};

const seedFile = (name: string, content: string, parentId = ROOT_ID, mimeType = 'text/markdown'): string => {
  const id = drive.newId();
  drive.files.set(id, {
    id,
    name,
    mimeType,
    parents: [parentId],
    content,
    createdTime: new Date('2026-05-01').toISOString(),
    modifiedTime: new Date('2026-05-01').toISOString(),
    version: '1',
  });
  return id;
};

// ---------------------------------------------------------------------------
// Tests — mirror the contract assertions from the other StorageRepositories.
// ---------------------------------------------------------------------------

describe('GoogleDriveStorageRepository listing', () => {
  it('lists files at the root with extensions stripped', async () => {
    seedFile('1.md', 'a');
    seedFile('2.md', 'b');
    seedFile('10.md', 'c');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10']);
  });

  it('returns folders as folder-summary entries', async () => {
    seedFolder('notes');
    seedFile('top.md', 'x');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('reports a missing folder as a recoverable NotFoundError', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('does/not/exist', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('GoogleDriveStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toBeTruthy();
    const stored = [...drive.files.values()].find(f => f.name === 'hello.md');
    expect(stored?.content).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect([...drive.files.values()].find(f => f.name === 'hello.md')).toBeUndefined();
  });

  it('createObject auto-creates real Drive folders for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    const stored = [...drive.files.values()];
    const folderA = stored.find(f => f.name === 'a' && f.mimeType === FOLDER_MIME_TYPE);
    const folderB = stored.find(f => f.name === 'b' && f.mimeType === FOLDER_MIME_TYPE);
    const fileC = stored.find(f => f.name === 'c.md');

    expect(folderA).toBeTruthy();
    expect(folderB?.parents).toContain(folderA!.id);
    expect(fileC?.parents).toContain(folderB!.id);
  });

  it('rejects a second createObject for the same key', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'one' } }),
    );

    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'hello', content: { body: 'two' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('createFolder creates a real Drive folder (no .keep placeholders)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));

    const folder = [...drive.files.values()].find(f => f.name === 'notes' && f.mimeType === FOLDER_MIME_TYPE);
    expect(folder).toBeTruthy();
    // No `.keep` placeholder should have been written.
    expect([...drive.files.values()].some(f => f.name === '.keep')).toBe(false);
  });

  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect([...drive.files.values()].some(f => f.name === 'notes')).toBe(true);
  });
});

describe('GoogleDriveStorageRepository token refresh', () => {
  it('calls tokenProvider before every request, picking up refreshed tokens', async () => {
    let callCount = 0;
    const tokenProvider = () => {
      callCount += 1;
      return `token-${callCount}`;
    };
    const repo = new GoogleDriveStorageRepository({
      auth: { tokenProvider },
      fetch: drive.fetch,
      serializerRegistry: {
        md: {
          format: { mediaType: 'text/markdown' } as never,
          serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
          deserializeDocumentFileContents: async raw => ({ body: raw }),
        },
      },
      defaultFileExtension: 'md',
    });

    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );

    // The repository made multiple Drive calls — tokenProvider should have been called for each.
    expect(callCount).toBeGreaterThan(1);
  });
});
