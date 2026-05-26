import { LaikaStream, LaikaTask, NotFoundError, VersionMismatchError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type SanityDocument, type SanityMutation, TYPE_FILE, TYPE_FOLDER } from './sanity-datasource.js';
import { SanityStorageRepository } from './sanity-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Sanity Content Lake — handles the exact GROQ queries this
// repository emits plus the four kinds of mutations it uses (create,
// createIfNotExists, patch, delete). Parsing GROQ in general would be a
// fool's errand; we instead match the literal query strings the repo emits
// and dispatch from a small switch.
// ---------------------------------------------------------------------------

const PROJECT = 'proj';
const DATASET = 'production';
const API_URL = `https://mock.sanity.test`;
const API_VERSION = 'v2024-09-01';

interface StoredDoc extends SanityDocument {
  _rev: string;
}

const createMockSanity = () => {
  const docs = new Map<string, StoredDoc>();
  let revCounter = 0;
  const newRev = (): string => `rev-${++revCounter}`;

  const matchDocs = (predicate: (doc: StoredDoc) => boolean): StoredDoc[] => [...docs.values()].filter(predicate);

  const runQuery = (query: string, params: Record<string, unknown>): StoredDoc[] => {
    const q = query.trim();
    // Order matters — more specific queries first.
    if (q === `*[_type == $type && parent == $parent && name in $names][0..1]`) {
      const names = params.names as string[];
      return matchDocs(d => d._type === params.type && d.parent === params.parent && names.includes(String(d.name)))
        .slice(0, 2);
    }
    if (q === `*[_type == $type && parent == $parent && name == $name][0..0]`) {
      return matchDocs(d => d._type === params.type && d.parent === params.parent && d.name === params.name).slice(
        0,
        1,
      );
    }
    if (
      q
        === `*[(_type == $folder || _type == $file) && parent == $parent && (name == $name || name match $namePattern)][0..0]`
    ) {
      const pattern = params.namePattern as string; // e.g. "hello.*"
      const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return matchDocs(d =>
        (d._type === params.folder || d._type === params.file)
        && d.parent === params.parent
        && (d.name === params.name || re.test(String(d.name)))
      ).slice(0, 1);
    }
    if (q === `*[(_type == $folder || _type == $file) && parent == $parent][0..0]`) {
      return matchDocs(d =>
        (d._type === params.folder || d._type === params.file)
        && d.parent === params.parent
      ).slice(0, 1);
    }
    if (q === `*[(_type == $folder || _type == $file) && parent == $parent]`) {
      return matchDocs(d =>
        (d._type === params.folder || d._type === params.file)
        && d.parent === params.parent
      );
    }
    if (q === `*[_type == $type && path == $path][0..0]`) {
      return matchDocs(d => d._type === params.type && d.path === params.path).slice(0, 1);
    }
    throw new Error(`unhandled GROQ query in mock: ${q}`);
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();

    const queryPath = `/${API_VERSION}/data/query/${DATASET}`;
    const mutatePath = `/${API_VERSION}/data/mutate/${DATASET}`;

    if (url.pathname === queryPath && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        query: string,
        params?: Record<string, unknown>,
      };
      try {
        const result = runQuery(body.query, body.params ?? {});
        return new Response(JSON.stringify({ result, ms: 0, query: body.query }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(
          JSON.stringify({ error: { description: (error as Error).message } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    if (url.pathname === mutatePath && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as { mutations: SanityMutation[] };
      const results: Array<{ id: string, operation: string }> = [];
      for (const mutation of body.mutations) {
        if ('create' in mutation) {
          const doc = mutation.create;
          if (docs.has(doc._id)) {
            return new Response(
              JSON.stringify({ error: { description: `Document ${doc._id} already exists` } }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            );
          }
          const now = new Date().toISOString();
          docs.set(doc._id, { ...doc, _createdAt: now, _updatedAt: now, _rev: newRev() } as StoredDoc);
          results.push({ id: doc._id, operation: 'create' });
        } else if ('createIfNotExists' in mutation) {
          const doc = mutation.createIfNotExists;
          if (!docs.has(doc._id)) {
            const now = new Date().toISOString();
            docs.set(doc._id, { ...doc, _createdAt: now, _updatedAt: now, _rev: newRev() } as StoredDoc);
          }
          results.push({ id: doc._id, operation: 'create' });
        } else if ('createOrReplace' in mutation) {
          const doc = mutation.createOrReplace;
          const existing = docs.get(doc._id);
          const now = new Date().toISOString();
          docs.set(doc._id, {
            ...doc,
            _createdAt: existing?._createdAt ?? now,
            _updatedAt: now,
            _rev: newRev(),
          } as StoredDoc);
          results.push({ id: doc._id, operation: 'createOrReplace' });
        } else if ('patch' in mutation) {
          const { id, set, ifRevisionID } = mutation.patch;
          const existing = docs.get(id);
          if (!existing) {
            return new Response(
              JSON.stringify({ error: { description: `Document ${id} not found` } }),
              { status: 404, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (ifRevisionID && existing._rev !== ifRevisionID) {
            return new Response(
              JSON.stringify({ error: { description: 'Revision mismatch' } }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            );
          }
          docs.set(id, {
            ...existing,
            ...(set ?? {}),
            _updatedAt: new Date().toISOString(),
            _rev: newRev(),
          });
          results.push({ id, operation: 'update' });
        } else if ('delete' in mutation) {
          docs.delete(mutation.delete.id);
          results.push({ id: mutation.delete.id, operation: 'delete' });
        }
      }
      return new Response(JSON.stringify({ transactionId: `tx-${revCounter}`, results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { docs, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockSanity>;

beforeEach(() => {
  mock = createMockSanity();
});
afterEach(() => {
  mock.docs.clear();
});

const makeRepo = () =>
  new SanityStorageRepository({
    projectId: PROJECT,
    dataset: DATASET,
    auth: { token: 'sanity-test' },
    apiUrl: API_URL,
    apiVersion: API_VERSION,
    fetch: mock.fetch,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SanityStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toBeTruthy();

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
  });

  it('commits deep keys + ancestor folders in a single atomic mutation transaction', async () => {
    const repo = makeRepo();
    // Watch how many mutate calls fly: with the transactional API there
    // should be exactly one for a deep create.
    let mutateCalls = 0;
    const innerFetch = mock.fetch;
    const wrapped: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname.includes('/mutate/') && init?.method === 'POST') mutateCalls += 1;
      return innerFetch(input, init);
    };
    const watchingRepo = new SanityStorageRepository({
      projectId: PROJECT,
      dataset: DATASET,
      auth: { token: 'sanity-test' },
      apiUrl: API_URL,
      apiVersion: API_VERSION,
      fetch: wrapped,
      serializerRegistry: {
        md: {
          format: { mediaType: 'text/markdown' } as never,
          serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
          deserializeDocumentFileContents: async raw => ({ body: raw }),
        },
      },
      defaultFileExtension: 'md',
    });

    void repo;
    await LaikaTask.runPromise(
      watchingRepo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    expect(mutateCalls).toBe(1);

    // Confirm the doc layout we got: two folder markers + one file, all in
    // the same transaction.
    const folders = [...mock.docs.values()].filter(d => d._type === TYPE_FOLDER);
    const files = [...mock.docs.values()].filter(d => d._type === TYPE_FILE);
    expect(folders.map(d => d.path).sort()).toEqual(['a', 'a/b']);
    expect(files.map(d => d.path)).toEqual(['a/b/c']);
  });

  it('rejects a duplicate createObject for the same key', async () => {
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
});

describe('SanityStorageRepository listing', () => {
  it('classifies laikaObject as object-summary and laikaFolder as folder-summary', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'top', content: { body: 'x' } }),
    );

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('sorts numeric filenames naturally and strips extensions', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '1', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '2', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '10', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10']);
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

describe('SanityStorageRepository optimistic concurrency', () => {
  it('rejects updateObject when the caller passes a stale `revisionId`', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'v1' } }),
    );

    // Concurrent edit from a different client invalidates the rev.
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'someone else v2' } }),
    );

    await expect(
      LaikaTask.runPromise(repo.updateObject({
        key: 'hello',
        content: { body: 'our v2' },
        metadata: { revisionId: created.metadata!.revisionId },
      })),
    ).rejects.toThrow(VersionMismatchError);
  });
});

describe('SanityStorageRepository folder semantics', () => {
  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect([...mock.docs.values()].some(d => d._type === TYPE_FOLDER && d.name === 'notes')).toBe(true);
  });

  it('refuses to delete the storage root', async () => {
    const attempt = await LaikaStream.runPromiseCollect(makeRepo().removeAtoms(['']));
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
  });
});
