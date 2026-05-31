import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { type TrelloCard, TrelloDataSource, type TrelloList } from '../trello-datasource.js';
import { TrelloStorageRepository } from '../trello-storage-repository.js';

const API = 'https://api.trello.test/1';
const BOARD_ID = 'board-laika';
const API_KEY = 'apikey-test';
const TOKEN = 'token-test';

const parseForm = (body: BodyInit | undefined): Record<string, string> => {
  if (!body) return {};
  const text = body instanceof URLSearchParams ? body.toString() : String(body);
  return Object.fromEntries(new URLSearchParams(text).entries());
};

const nowIso = (): string => new Date().toISOString();

const createMockTrello = () => {
  const lists = new Map<string, TrelloList>();
  const cards = new Map<string, TrelloCard>();
  let listIdCounter = 0;
  let cardIdCounter = 0;

  const nextListId = (): string => `list-${++listIdCounter}`;
  const nextCardId = (): string => `card-${++cardIdCounter}`;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (!url.startsWith(API)) return new Response('not found', { status: 404 });
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = new URL(url);

    const urlKey = u.searchParams.get('key');
    const urlToken = u.searchParams.get('token');
    if (urlKey !== API_KEY || urlToken !== TOKEN) return new Response('Unauthorized', { status: 401 });

    const path = u.pathname.replace(/^\/1\//, '');

    let m = path.match(/^boards\/([^/]+)\/lists$/);
    if (m && method === 'GET') {
      const boardId = decodeURIComponent(m[1]!);
      const filter = u.searchParams.get('filter') ?? 'all';
      const matches = [...lists.values()].filter(
        l => l.idBoard === boardId && (filter !== 'open' || !l.closed),
      );
      return new Response(JSON.stringify(matches), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    m = path.match(/^lists\/([^/]+)\/cards$/);
    if (m && method === 'GET') {
      const listId = decodeURIComponent(m[1]!);
      const filter = u.searchParams.get('filter') ?? 'all';
      const matches = [...cards.values()].filter(
        c => c.idList === listId && (filter !== 'open' || !c.closed),
      );
      return new Response(JSON.stringify(matches), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    m = path.match(/^cards\/([^/]+)$/);
    if (m && method === 'GET') {
      const cardId = decodeURIComponent(m[1]!);
      const card = cards.get(cardId);
      if (!card) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(card), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (path === 'lists' && method === 'POST') {
      const form = parseForm(init?.body as BodyInit | undefined);
      const id = nextListId();
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

    m = path.match(/^lists\/([^/]+)\/closed$/);
    if (m && method === 'PUT') {
      const listId = decodeURIComponent(m[1]!);
      const list = lists.get(listId);
      if (!list) return new Response('not found', { status: 404 });
      const form = parseForm(init?.body as BodyInit | undefined);
      lists.set(listId, { ...list, closed: form['value'] === 'true' });
      return new Response(JSON.stringify(lists.get(listId)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    m = path.match(/^cards\/([^/]+)$/);
    if (m && method === 'DELETE') {
      const cardId = decodeURIComponent(m[1]!);
      if (!cards.has(cardId)) return new Response('not found', { status: 404 });
      cards.delete(cardId);
      return new Response('', { status: 200 });
    }

    return new Response(`mock: no route for ${method} ${path}`, { status: 404 });
  };

  return { lists, cards, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const trelloContractCase: StorageContractCase = {
  name: 'TrelloStorageRepository',
  async makeRepo() {
    const mock = createMockTrello();
    const ds = new TrelloDataSource({
      apiUrl: API,
      boardId: BOARD_ID,
      auth: { apiKey: API_KEY, token: TOKEN },
      fetch: mock.fetch,
    });
    return new TrelloStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry() as never,
      defaultFileExtension: 'json',
    });
  },
  skip: ['updateObject'],
};
