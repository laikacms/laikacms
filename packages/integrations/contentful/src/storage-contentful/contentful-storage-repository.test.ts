import { LaikaStream, LaikaTask, NotFoundError, VersionMismatchError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContentfulStorageRepository } from './contentful-storage-repository.js';

// ---------------------------------------------------------------------------
// Tiny in-memory Contentful CMA mock — handles the subset the repository
// touches: content_types CRUD, content_types/{id}/published activation,
// entries CRUD with X-Contentful-Version OCC and X-Contentful-Content-Type.
// ---------------------------------------------------------------------------

interface MockContentType {
  id: string;
  name: string;
  version: number;
  publishedVersion?: number;
  createdAt: string;
  updatedAt: string;
}

interface MockEntry {
  id: string;
  contentTypeId: string;
  version: number;
  fields: Record<string, Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

const SPACE = 'demo-space';
const ENV = 'master';
const API_URL = 'https://mock.cma.contentful.test';

const headerOf = (init: RequestInit | undefined, name: string): string | undefined => {
  if (!init?.headers) return undefined;
  const h = init.headers as Record<string, string>;
  return h[name] ?? h[name.toLowerCase()];
};

const createMockCma = () => {
  const contentTypes = new Map<string, MockContentType>();
  const entries = new Map<string, MockEntry>();

  const ctEnvelope = (ct: MockContentType, fields: Array<Record<string, unknown>>) => ({
    sys: {
      id: ct.id,
      type: 'ContentType',
      version: ct.version,
      publishedVersion: ct.publishedVersion,
      createdAt: ct.createdAt,
      updatedAt: ct.updatedAt,
    },
    name: ct.name,
    fields,
  });

  const entryEnvelope = (entry: MockEntry) => ({
    sys: {
      id: entry.id,
      type: 'Entry',
      version: entry.version,
      contentType: { sys: { id: entry.contentTypeId } },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    },
    fields: entry.fields,
  });

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const envPrefix = `/spaces/${SPACE}/environments/${ENV}`;
    const path = url.pathname.startsWith(envPrefix) ? url.pathname.slice(envPrefix.length) : url.pathname;

    // ---- Content types -------------------------------------------------
    if (path === '/content_types' && method === 'GET') {
      const items = [...contentTypes.values()].map(ct => ctEnvelope(ct, []));
      return json({ items, total: items.length });
    }
    const ctMatch = path.match(/^\/content_types\/([^/]+)$/);
    const ctPublishedMatch = path.match(/^\/content_types\/([^/]+)\/published$/);

    if (ctMatch && method === 'GET') {
      const id = decodeURIComponent(ctMatch[1]);
      const ct = contentTypes.get(id);
      if (!ct) return json({ message: 'not found' }, { status: 404 });
      return json(ctEnvelope(ct, []));
    }
    if (ctMatch && method === 'PUT') {
      const id = decodeURIComponent(ctMatch[1]);
      const body = JSON.parse((init?.body as string) ?? '{}') as { name: string, fields: unknown[] };
      const now = new Date().toISOString();
      const existing = contentTypes.get(id);
      const ct: MockContentType = existing
        ? { ...existing, name: body.name, version: existing.version + 1, updatedAt: now }
        : { id, name: body.name, version: 1, createdAt: now, updatedAt: now };
      contentTypes.set(id, ct);
      return json(ctEnvelope(ct, body.fields as Array<Record<string, unknown>>));
    }
    if (ctPublishedMatch && method === 'PUT') {
      const id = decodeURIComponent(ctPublishedMatch[1]);
      const ct = contentTypes.get(id);
      if (!ct) return json({ message: 'not found' }, { status: 404 });
      const v = Number(headerOf(init, 'X-Contentful-Version') ?? 0);
      if (v !== ct.version) return json({ message: 'version mismatch' }, { status: 409 });
      const now = new Date().toISOString();
      const next: MockContentType = {
        ...ct,
        publishedVersion: ct.version,
        version: ct.version + 1,
        updatedAt: now,
      };
      contentTypes.set(id, next);
      return json(ctEnvelope(next, []));
    }

    // ---- Entries -------------------------------------------------------
    if (path === '/entries' && method === 'GET') {
      const contentTypeId = url.searchParams.get('content_type');
      const matched = [...entries.values()].filter(e => !contentTypeId || e.contentTypeId === contentTypeId);
      return json({ items: matched.map(entryEnvelope), total: matched.length });
    }
    const entryMatch = path.match(/^\/entries\/([^/]+)$/);
    if (entryMatch && method === 'GET') {
      const id = decodeURIComponent(entryMatch[1]);
      const entry = entries.get(id);
      if (!entry) return json({ message: 'not found' }, { status: 404 });
      return json(entryEnvelope(entry));
    }
    if (entryMatch && method === 'PUT') {
      const id = decodeURIComponent(entryMatch[1]);
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        fields: Record<string, Record<string, unknown>>,
      };
      const contentTypeHdr = headerOf(init, 'X-Contentful-Content-Type');
      const versionHdr = headerOf(init, 'X-Contentful-Version');
      const existing = entries.get(id);
      const now = new Date().toISOString();

      if (!existing) {
        if (!contentTypeHdr) {
          return json({ message: 'X-Contentful-Content-Type required for create' }, { status: 422 });
        }
        const entry: MockEntry = {
          id,
          contentTypeId: contentTypeHdr,
          version: 1,
          fields: body.fields,
          createdAt: now,
          updatedAt: now,
        };
        entries.set(id, entry);
        return json(entryEnvelope(entry));
      }
      // Update path
      if (versionHdr === undefined) {
        return json({ message: 'X-Contentful-Version required for update' }, { status: 409 });
      }
      if (Number(versionHdr) !== existing.version) {
        return json({ message: 'version mismatch' }, { status: 409 });
      }
      const updated: MockEntry = {
        ...existing,
        fields: body.fields,
        version: existing.version + 1,
        updatedAt: now,
      };
      entries.set(id, updated);
      return json(entryEnvelope(updated));
    }
    if (entryMatch && method === 'DELETE') {
      const id = decodeURIComponent(entryMatch[1]);
      const entry = entries.get(id);
      if (!entry) return json({ message: 'not found' }, { status: 404 });
      const versionHdr = headerOf(init, 'X-Contentful-Version');
      if (versionHdr === undefined || Number(versionHdr) !== entry.version) {
        return json({ message: 'version mismatch' }, { status: 409 });
      }
      entries.delete(id);
      return new Response(null, { status: 204 });
    }

    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { contentTypes, entries, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let cma: ReturnType<typeof createMockCma>;

beforeEach(() => {
  cma = createMockCma();
});
afterEach(() => {
  cma.contentTypes.clear();
  cma.entries.clear();
});

const makeRepo = () =>
  new ContentfulStorageRepository({
    spaceId: SPACE,
    environmentId: ENV,
    auth: { accessToken: 'CFPAT-test' },
    apiUrl: API_URL,
    fetch: cma.fetch,
  });

const seedContentType = (id: string) => {
  const now = new Date('2026-01-01').toISOString();
  cma.contentTypes.set(id, { id, name: id, version: 2, publishedVersion: 1, createdAt: now, updatedAt: now });
};

const seedEntry = (id: string, contentTypeId: string, fields: Record<string, unknown>) => {
  const now = new Date('2026-01-01').toISOString();
  cma.entries.set(id, {
    id,
    contentTypeId,
    version: 1,
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, { 'en-US': v }]),
    ),
    createdAt: now,
    updatedAt: now,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentfulStorageRepository listing', () => {
  it('lists every content type as a folder under the root', async () => {
    seedContentType('blog');
    seedContentType('author');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key).sort()).toEqual(['author', 'blog']);
    expect(collected.data.every(s => s.type === 'folder-summary')).toBe(true);
  });

  it('lists entries of a content type as object-summaries', async () => {
    seedContentType('blog');
    seedEntry('first', 'blog', { title: 'First' });
    seedEntry('second', 'blog', { title: 'Second' });

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('blog', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key).sort()).toEqual(['blog/first', 'blog/second']);
    expect(collected.data.every(s => s.type === 'object-summary')).toBe(true);
  });

  it('reports a missing content type as a recoverable NotFoundError', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('does-not-exist', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('ContentfulStorageRepository CRUD', () => {
  it('createFolder ensures and activates a content type', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'blog' }));

    expect(cma.contentTypes.get('blog')).toBeTruthy();
    expect(cma.contentTypes.get('blog')?.publishedVersion).toBeGreaterThan(0);
  });

  it('creates, reads, updates and deletes an entry — round-tripping fields under the default locale', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'blog' }));

    const created = await LaikaTask.runPromise(
      repo.createObject({
        type: 'object',
        key: 'blog/hello',
        content: { title: 'Hello', body: 'World' },
      }),
    );
    expect(created.key).toBe('blog/hello');
    expect(created.content).toEqual({ title: 'Hello', body: 'World' });
    expect(created.metadata?.revisionId).toBe('1');

    // Internal shape: fields are wrapped under the default locale.
    expect(cma.entries.get('hello')?.fields).toEqual({
      title: { 'en-US': 'Hello' },
      body: { 'en-US': 'World' },
    });

    const fetched = await LaikaTask.runPromise(repo.getObject('blog/hello'));
    expect(fetched.content).toEqual({ title: 'Hello', body: 'World' });

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'blog/hello', content: { body: 'Updated' } }),
    );
    expect(updated.content).toEqual({ title: 'Hello', body: 'Updated' });
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['blog/hello']));
    expect(removed.data).toEqual(['blog/hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(cma.entries.has('hello')).toBe(false);
  });

  it('rejects creating an entry under a missing content type with a NotFoundError', async () => {
    const repo = makeRepo();
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'blog/x', content: { title: 'X' } }),
      ),
    ).rejects.toThrow(/Content type "blog"/i);
  });

  it('rejects keys deeper than two segments', async () => {
    const repo = makeRepo();
    await expect(
      LaikaTask.runPromise(repo.getObject('blog/a/b')),
    ).rejects.toThrow(/<contentType>\/<entryId>/);
  });

  it('rejects a duplicate createObject for the same entry id', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'blog' }));
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'blog/x', content: { title: 'A' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'blog/x', content: { title: 'B' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });
});

describe('ContentfulStorageRepository optimistic concurrency', () => {
  it('rejects updateObject when the caller passes a stale revisionId', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'blog' }));
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'blog/hello', content: { body: 'v1' } }),
    );

    // Simulate a concurrent edit by someone else.
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'blog/hello', content: { body: 'v2-from-someone-else' } }),
    );

    // Our update with the stale revisionId should be rejected.
    await expect(
      LaikaTask.runPromise(
        repo.updateObject({
          key: 'blog/hello',
          content: { body: 'v2-from-us' },
          metadata: { revisionId: created.metadata!.revisionId },
        }),
      ),
    ).rejects.toThrow(VersionMismatchError);
  });
});
