import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type TrelloCard, TrelloDataSource, type TrelloList } from './trello-datasource.js';
import { TrelloStorageRepository } from './trello-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Trello REST mock.
//
// Implements only the endpoints the repository emits:
//
//   GET    /1/boards/{id}/lists?filter=open&cards=none
//   GET    /1/lists/{id}/cards?filter=open
//   GET    /1/cards/{id}
//   POST   /1/lists                (form: name, idBoard, pos)
//   POST   /1/cards                (form: idList, name, desc, pos)
//   PUT    /1/cards/{id}           (form: name?, desc?, pos?, closed?)
//   PUT    /1/lists/{id}/closed    (form: value)
//   DELETE /1/cards/{id}
//
// All authenticated via `?key=&token=` URL query parameters — that's the
// load-bearing wire-shape distinction this iteration exercises.
// ---------------------------------------------------------------------------

const API = 'https://api.trello.test/1';
const BOARD_ID = 'board-laika';
const API_KEY = 'apikey-test';
const TOKEN = 'token-test';

let lists: Map<string, TrelloList>;     // by id
let cards: Map<string, TrelloCard>;     // by id
let listIdCounter: number;
let cardIdCounter: number;
let urlKeyParam: string | null = null;
let urlTokenParam: string | null = null;
let listRequestCount: number = 0;
let cardDeleteCount: number = 0;

const nextListId = (): string => `list-${++listIdCounter}`;
const nextCardId = (): string => `card-${++cardIdCounter}`;
const nowIso = (): string => new Date().toISOString();

// ---- Form parser helper -------------------------------------------------

const parseForm = (body: BodyInit | undefined): Record<string, string> => {
  if (!body) return {};
  // URLSearchParams round-trips through string when sent as body.
  const text = body instanceof URLSearchParams ? body.toString() : String(body);
  return Object.fromEntries(new URLSearchParams(text).entries());
};

// ---- Mock fetch ---------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (!url.startsWith(API)) return new Response('not found', { status: 404 });
  const method = (init?.method ?? 'GET').toUpperCase();
  const u = new URL(url);

  // Verify the auth query parameters are present and correct.
  urlKeyParam = u.searchParams.get('key');
  urlTokenParam = u.searchParams.get('token');
  if (urlKeyParam !== API_KEY || urlTokenParam !== TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  const path = u.pathname.replace(/^\/1\//, '');

  // ---- GET /boards/{id}/lists --------------------------------------------
  let m = path.match(/^boards\/([^/]+)\/lists$/);
  if (m && method === 'GET') {
    listRequestCount += 1;
    const boardId = decodeURIComponent(m[1]!);
    const filter = u.searchParams.get('filter') ?? 'all';
    const matches = [...lists.values()].filter(
      l => l.idBoard === boardId && (filter !== 'open' || !l.closed),
    );
    return new Response(JSON.stringify(matches), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- GET /lists/{id}/cards -----------------------------------------------
  m = path.match(/^lists\/([^/]+)\/cards$/);
  if (m && method === 'GET') {
    const listId = decodeURIComponent(m[1]!);
    const filter = u.searchParams.get('filter') ?? 'all';
    const matches = [...cards.values()].filter(
      c => c.idList === listId && (filter !== 'open' || !c.closed),
    );
    return new Response(JSON.stringify(matches), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- GET /cards/{id} ----------------------------------------------------
  m = path.match(/^cards\/([^/]+)$/);
  if (m && method === 'GET') {
    const cardId = decodeURIComponent(m[1]!);
    const card = cards.get(cardId);
    if (!card) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(card), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- POST /lists --------------------------------------------------------
  if (path === 'lists' && method === 'POST') {
    const form = parseForm(init?.body as BodyInit | undefined);
    const id = nextListId();
    // Assign `pos` as a float — Trello's idiom for ordering.
    const lastPos = Math.max(0, ...[...lists.values()].filter(l => l.idBoard === form['idBoard']).map(l => l.pos));
    const newList: TrelloList = {
      id,
      name: form['name'] ?? '',
      closed: false,
      pos: form['pos'] === 'bottom' ? lastPos + 1000.0 : Number(form['pos'] ?? lastPos + 1000.0),
      idBoard: form['idBoard'] ?? '',
    };
    lists.set(id, newList);
    return new Response(JSON.stringify(newList), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- POST /cards --------------------------------------------------------
  if (path === 'cards' && method === 'POST') {
    const form = parseForm(init?.body as BodyInit | undefined);
    const id = nextCardId();
    const idList = form['idList']!;
    const list = lists.get(idList);
    const lastPos = Math.max(0, ...[...cards.values()].filter(c => c.idList === idList).map(c => c.pos));
    const newCard: TrelloCard = {
      id,
      name: form['name'] ?? '',
      desc: form['desc'] ?? '',
      closed: false,
      pos: form['pos'] === 'bottom' ? lastPos + 1000.0 : Number(form['pos'] ?? lastPos + 1000.0),
      idList,
      idBoard: list?.idBoard ?? '',
      dateLastActivity: nowIso(),
    };
    cards.set(id, newCard);
    return new Response(JSON.stringify(newCard), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- PUT /cards/{id} ----------------------------------------------------
  m = path.match(/^cards\/([^/]+)$/);
  if (m && method === 'PUT') {
    const cardId = decodeURIComponent(m[1]!);
    const card = cards.get(cardId);
    if (!card) return new Response('not found', { status: 404 });
    const form = parseForm(init?.body as BodyInit | undefined);
    const updated: TrelloCard = {
      ...card,
      ...(form['name'] !== undefined ? { name: form['name'] } : {}),
      ...(form['desc'] !== undefined ? { desc: form['desc'] } : {}),
      ...(form['pos'] !== undefined ? { pos: Number(form['pos']) } : {}),
      ...(form['closed'] !== undefined ? { closed: form['closed'] === 'true' } : {}),
      dateLastActivity: nowIso(),
    };
    cards.set(cardId, updated);
    return new Response(JSON.stringify(updated), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- PUT /lists/{id}/closed --------------------------------------------
  m = path.match(/^lists\/([^/]+)\/closed$/);
  if (m && method === 'PUT') {
    const listId = decodeURIComponent(m[1]!);
    const list = lists.get(listId);
    if (!list) return new Response('not found', { status: 404 });
    const form = parseForm(init?.body as BodyInit | undefined);
    lists.set(listId, { ...list, closed: form['value'] === 'true' });
    return new Response(JSON.stringify(lists.get(listId)), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // ---- DELETE /cards/{id} ------------------------------------------------
  m = path.match(/^cards\/([^/]+)$/);
  if (m && method === 'DELETE') {
    cardDeleteCount += 1;
    const cardId = decodeURIComponent(m[1]!);
    if (!cards.has(cardId)) return new Response('not found', { status: 404 });
    cards.delete(cardId);
    return new Response('', { status: 200 });
  }

  return new Response(`mock: no route for ${method} ${path}`, { status: 404 });
};

// ---------------------------------------------------------------------------
// Serializer registry
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) =>
      String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (fetchImpl: typeof fetch = mockFetch): TrelloStorageRepository => {
  const ds = new TrelloDataSource({
    apiUrl: API,
    boardId: BOARD_ID,
    auth: { apiKey: API_KEY, token: TOKEN },
    fetch: fetchImpl,
  });
  return new TrelloStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  lists = new Map();
  cards = new Map();
  listIdCounter = 0;
  cardIdCounter = 0;
  urlKeyParam = null;
  urlTokenParam = null;
  listRequestCount = 0;
  cardDeleteCount = 0;
});

afterEach(() => {
  lists.clear();
  cards.clear();
});

describe('TrelloStorageRepository', () => {
  it('createObject creates a list named after the parent path + a card named after the file', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');

    // Verify a list "notes" exists.
    const list = [...lists.values()].find(l => l.name === 'notes');
    expect(list).toBeDefined();
    // Verify a card "hello.md" exists in that list with the right desc.
    const card = [...cards.values()].find(c => c.idList === list!.id && c.name === 'hello.md');
    expect(card).toBeDefined();
    expect(card?.desc).toBe('hi');

    // Round-trip read.
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('every request carries ?key=&token= URL query parameters', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    expect(urlKeyParam).toBe(API_KEY);
    expect(urlTokenParam).toBe(TOKEN);
  });

  it('root-level files go into the __root__ list', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'standalone', content: { body: 'a' } }),
    );
    const rootList = [...lists.values()].find(l => l.name === '__root__');
    expect(rootList).toBeDefined();
    const card = [...cards.values()].find(c => c.idList === rootList!.id);
    expect(card?.name).toBe('standalone.md');
  });

  it('deep paths flatten into list names (notes/sub/deep)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/sub/deep', content: { body: 'd' } }),
    );
    // The list name IS the parent path with slashes preserved.
    const list = [...lists.values()].find(l => l.name === 'notes/sub');
    expect(list).toBeDefined();
    const card = [...cards.values()].find(c => c.idList === list!.id);
    expect(card?.name).toBe('deep.md');
  });

  it('cards get a floating-point `pos` value (server-assigned ordering)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/b', content: { body: 'b' } }));
    const allCards = [...cards.values()];
    expect(allCards).toHaveLength(2);
    // Both pos values are positive floats.
    for (const c of allCards) {
      expect(typeof c.pos).toBe('number');
      expect(c.pos).toBeGreaterThan(0);
    }
    // The second card created has a higher pos (appended at bottom).
    expect(allCards[1]!.pos).toBeGreaterThan(allCards[0]!.pos);
  });

  it('`dateLastActivity` surfaces as `metadata.revisionId`', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // Trello's server-managed timestamp.
    expect(created.metadata?.revisionId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('updateObject changes desc and advances dateLastActivity', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await new Promise(r => setTimeout(r, 5));  // ensure timestamp advances
    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);
    const card = [...cards.values()].find(c => c.name === 'x.md');
    expect(card?.desc).toBe('b');
  });

  it('createObject rejects duplicates via the resolveFile probe', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('removeAtoms does N parallel DELETE /1/cards/:id calls', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    cardDeleteCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // Honest: 3 separate DELETEs. Trello has no bulk-delete endpoint.
    expect(cardDeleteCount).toBe(3);
    // The `notes` list remains (Trello soft-deletes lists only).
    expect([...lists.values()].some(l => l.name === 'notes' && !l.closed)).toBe(true);
  });

  it('removeAtoms reports missing keys as skipped', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/nope']),
    );
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries returns files + nested folders for a parent', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/sub/c', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('notes', { pagination: PAGE }),
    );
    const types = collected.data.reduce((acc, s) => {
      acc[s.key] = s.type;
      return acc;
    }, {} as Record<string, string>);
    expect(types).toEqual({
      'notes/a': 'object-summary',
      'notes/b': 'object-summary',
      'notes/sub': 'folder-summary',
    });
  });

  it('createFolder creates an empty list', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    const list = [...lists.values()].find(l => l.name === 'empty');
    expect(list).toBeDefined();
    expect(list?.closed).toBe(false);
    const folder = await LaikaTask.runPromise(repo.getFolder('empty'));
    expect(folder.type).toBe('folder');
  });

  it('createFolder is idempotent — re-creating returns the existing list', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    const matching = [...lists.values()].filter(l => l.name === 'twice');
    expect(matching).toHaveLength(1);
  });

  it('getFolder fails for a missing list', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found|open lists/i);
  });

  it('listBoardLists filters out archived (closed=true) lists', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'visible' }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'hidden' }));
    // Archive `hidden` via the data source.
    const hidden = [...lists.values()].find(l => l.name === 'hidden')!;
    hidden.closed = true;
    lists.set(hidden.id, hidden);

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: PAGE }),
    );
    const folderNames = collected.data.filter(s => s.type === 'folder-summary').map(s => s.key);
    expect(folderNames).toEqual(['visible']);
  });
});
