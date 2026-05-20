import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotionStorageRepository } from './notion-storage-repository.js';

// ---------------------------------------------------------------------------
// Tiny in-memory Notion — pages have id/title/parent/archived, plus an ordered
// list of paragraph blocks. Child-page relationships are modelled as
// `child_page` blocks in the parent's children list, mirroring the wire shape.
// ---------------------------------------------------------------------------

interface MockPage {
  id: string;
  parentId: string | null;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  paragraphs: Array<{ id: string; text: string; archived: boolean }>;
}

const ROOT_ID = 'root-page';
const API_URL = 'https://mock.notion.test';

const createMockNotion = () => {
  const pages = new Map<string, MockPage>();
  let idCounter = 0;
  const newId = (): string => `page-${++idCounter}`;
  const newBlockId = (): string => `block-${++idCounter}`;

  // Seed the root.
  pages.set(ROOT_ID, {
    id: ROOT_ID,
    parentId: null,
    title: 'Root',
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    paragraphs: [],
  });

  const childrenOf = (parentId: string): MockPage[] =>
    [...pages.values()].filter(p => p.parentId === parentId && !p.archived);

  const blockListOf = (parentId: string) => {
    const page = pages.get(parentId);
    if (!page) return [];
    const blocks: Array<Record<string, unknown>> = [];
    for (const paragraph of page.paragraphs) {
      if (paragraph.archived) continue;
      blocks.push({
        id: paragraph.id,
        type: 'paragraph',
        has_children: false,
        archived: false,
        paragraph: { rich_text: [{ plain_text: paragraph.text }] },
      });
    }
    for (const child of childrenOf(parentId)) {
      blocks.push({
        id: child.id,
        type: 'child_page',
        has_children: childrenOf(child.id).length > 0,
        archived: false,
        child_page: { title: child.title },
      });
    }
    return blocks;
  };

  const pageEnvelope = (page: MockPage) => ({
    id: page.id,
    archived: page.archived,
    created_time: page.createdAt,
    last_edited_time: page.updatedAt,
    properties: {
      title: { type: 'title', title: [{ plain_text: page.title }] },
    },
  });

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    // ---- GET /pages/{id} -----------------------------------------------
    const pageMatch = path.match(/^\/pages\/([^/]+)$/);
    if (pageMatch && method === 'GET') {
      const id = decodeURIComponent(pageMatch[1]);
      const page = pages.get(id);
      if (!page || page.archived) return json({ message: 'Not found' }, { status: 404 });
      return json(pageEnvelope(page));
    }
    if (pageMatch && method === 'PATCH') {
      const id = decodeURIComponent(pageMatch[1]);
      const page = pages.get(id);
      if (!page) return json({ message: 'Not found' }, { status: 404 });
      const body = JSON.parse((init?.body as string) ?? '{}') as { archived?: boolean };
      if (body.archived === true) page.archived = true;
      page.updatedAt = new Date().toISOString();
      return json(pageEnvelope(page));
    }

    // ---- POST /pages -------------------------------------------------
    if (path === '/pages' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        parent: { page_id: string };
        properties: { title: { title: Array<{ text: { content: string } }> } };
        children?: Array<{ type: 'paragraph'; paragraph: { rich_text: Array<{ text: { content: string } }> } }>;
      };
      const id = newId();
      const now = new Date().toISOString();
      const title = body.properties.title.title.map(rt => rt.text.content).join('');
      const page: MockPage = {
        id,
        parentId: body.parent.page_id,
        title,
        archived: false,
        createdAt: now,
        updatedAt: now,
        paragraphs: (body.children ?? []).map(c => ({
          id: newBlockId(),
          text: (c.paragraph?.rich_text ?? []).map(rt => rt.text.content).join(''),
          archived: false,
        })),
      };
      pages.set(id, page);
      return json(pageEnvelope(page));
    }

    // ---- GET /blocks/{id}/children -----------------------------------
    const blocksChildrenMatch = path.match(/^\/blocks\/([^/]+)\/children$/);
    if (blocksChildrenMatch && method === 'GET') {
      const id = decodeURIComponent(blocksChildrenMatch[1]);
      if (!pages.has(id)) return json({ message: 'Not found' }, { status: 404 });
      return json({ results: blockListOf(id), next_cursor: null });
    }
    if (blocksChildrenMatch && method === 'PATCH') {
      const id = decodeURIComponent(blocksChildrenMatch[1]);
      const page = pages.get(id);
      if (!page) return json({ message: 'Not found' }, { status: 404 });
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        children: Array<{ type: 'paragraph'; paragraph: { rich_text: Array<{ text: { content: string } }> } }>;
      };
      for (const child of body.children) {
        if (child.type !== 'paragraph') continue;
        page.paragraphs.push({
          id: newBlockId(),
          text: child.paragraph.rich_text.map(rt => rt.text.content).join(''),
          archived: false,
        });
      }
      page.updatedAt = new Date().toISOString();
      return json({ results: [] });
    }

    // ---- DELETE /blocks/{id} (archive) ------------------------------
    const blockMatch = path.match(/^\/blocks\/([^/]+)$/);
    if (blockMatch && method === 'DELETE') {
      const id = decodeURIComponent(blockMatch[1]);
      // Could be a paragraph or a child_page (= page).
      for (const page of pages.values()) {
        const p = page.paragraphs.find(par => par.id === id);
        if (p) { p.archived = true; return new Response(null, { status: 200 }); }
      }
      const page = pages.get(id);
      if (page) { page.archived = true; return new Response(null, { status: 200 }); }
      return json({ message: 'Not found' }, { status: 404 });
    }

    return new Response(`{"unhandled":"${method} ${path}"}`, { status: 501 });
  };

  return { pages, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockNotion>;

beforeEach(() => { mock = createMockNotion(); });
afterEach(() => { mock.pages.clear(); });

const makeRepo = () =>
  new NotionStorageRepository({
    auth: { accessToken: 'secret_test' },
    apiUrl: API_URL,
    rootPageId: ROOT_ID,
    fetch: mock.fetch,
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotionStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'Hi there' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'Hi there' });

    const fetched = await LaikaTask.runPromise(repo.getObject('hello'));
    expect(fetched.content).toEqual({ body: 'Hi there' });

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'Edited' } }),
    );
    expect(updated.content).toEqual({ body: 'Edited' });

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
  });

  it('createObject ensures the ancestor page chain for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    const all = [...mock.pages.values()].filter(p => !p.archived);
    expect(all.map(p => p.title).sort()).toEqual(['Root', 'a', 'b', 'c']);

    // The body lives on the leaf page only.
    const c = all.find(p => p.title === 'c')!;
    expect(c.paragraphs.map(p => p.text).filter(t => t)).toEqual(['deep']);
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

describe('NotionStorageRepository listing', () => {
  it('classifies leaf pages as object-summary and pages-with-children as folder-summary', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'top', content: { body: 'hi' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('sorts numeric filenames naturally', async () => {
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

describe('NotionStorageRepository folder semantics', () => {
  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }));

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);

    // The folder page is still there.
    expect([...mock.pages.values()].find(p => p.title === 'notes')?.archived).toBe(false);
  });

  it('refuses to delete the configured root', async () => {
    const attempt = await LaikaStream.runPromiseCollect(makeRepo().removeAtoms(['']));
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
  });
});

describe('NotionStorageRepository auth', () => {
  it('calls tokenProvider before every request, picking up refreshed tokens', async () => {
    let callCount = 0;
    const repo = new NotionStorageRepository({
      auth: { tokenProvider: () => { callCount += 1; return `t-${callCount}`; } },
      apiUrl: API_URL,
      rootPageId: ROOT_ID,
      fetch: mock.fetch,
    });
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(callCount).toBeGreaterThan(1);
  });
});
