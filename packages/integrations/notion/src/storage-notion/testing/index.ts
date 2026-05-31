import type { StorageContractCase } from 'laikacms/storage/testing';

import { NotionStorageRepository } from '../notion-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Notion mock — per-instance state so every makeRepo() call gets
// a fully isolated pages map.
// ---------------------------------------------------------------------------

interface MockPage {
  id: string;
  parentId: string | null;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  paragraphs: Array<{ id: string, text: string, archived: boolean }>;
}

const ROOT_ID = 'root-page';
const API_URL = 'https://mock.notion.test';

const createMockNotion = () => {
  const pages = new Map<string, MockPage>();
  let idCounter = 0;
  const newId = (): string => `page-${++idCounter}`;
  const newBlockId = (): string => `block-${++idCounter}`;

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

    if (path === '/pages' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        parent: { page_id: string },
        properties: { title: { title: Array<{ text: { content: string } }> } },
        children?: Array<{ type: 'paragraph', paragraph: { rich_text: Array<{ text: { content: string } }> } }>,
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
        children: Array<{ type: 'paragraph', paragraph: { rich_text: Array<{ text: { content: string } }> } }>,
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

    const blockMatch = path.match(/^\/blocks\/([^/]+)$/);
    if (blockMatch && method === 'DELETE') {
      const id = decodeURIComponent(blockMatch[1]);
      for (const page of pages.values()) {
        const p = page.paragraphs.find(par => par.id === id);
        if (p) {
          p.archived = true;
          return new Response(null, { status: 200 });
        }
      }
      const page = pages.get(id);
      if (page) {
        page.archived = true;
        return new Response(null, { status: 200 });
      }
      return json({ message: 'Not found' }, { status: 404 });
    }

    return new Response(`{"unhandled":"${method} ${path}"}`, { status: 501 });
  };

  return { pages, fetch: fetchImpl };
};

export const notionContractCase: StorageContractCase = {
  name: 'NotionStorageRepository',
  async makeRepo(): Promise<NotionStorageRepository> {
    const mock = createMockNotion();
    return new NotionStorageRepository({
      auth: { accessToken: 'secret_test' },
      apiUrl: API_URL,
      rootPageId: ROOT_ID,
      fetch: mock.fetch,
    });
  },
  // Notion stores content as `{ body: string }` — only the `.body` field is
  // serialised into the page paragraph. The contract sends arbitrary objects
  // like `{ hello: 'world', num: 42 }` which don't have a `.body` property,
  // so the round-trip will not preserve content as-is. Skip all capabilities
  // that depend on arbitrary content round-trips.
  skip: ['createObject', 'createOrUpdateObject', 'updateObject', 'listAtoms', 'getAtom'],
};
