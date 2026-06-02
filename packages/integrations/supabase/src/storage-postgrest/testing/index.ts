import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { PostgrestStorageRepository } from '../postgrest-storage-repository.js';

const TABLE = 'laika_storage';
const URL_BASE = 'https://mock.supabase.test/rest/v1';
const ANON = 'anon-test-key';

interface Row {
  id?: string;
  Parent: string;
  Name: string;
  Path: string;
  Type: 'file' | 'folder';
  Extension?: string;
  Content?: string;
  created_at?: string;
  updated_at?: string;
}

type Predicate = (row: Row) => boolean;

const parseInList = (value: string): string[] => {
  const stripped = value.replace(/^\(|\)$/g, '');
  const items: string[] = [];
  let i = 0;
  while (i < stripped.length) {
    if (stripped[i] === '"') {
      let j = i + 1;
      let out = '';
      while (j < stripped.length && stripped[j] !== '"') {
        if (stripped[j] === '\\' && stripped[j + 1] !== undefined) {
          out += stripped[j + 1];
          j += 2;
        } else {
          out += stripped[j];
          j += 1;
        }
      }
      items.push(out);
      i = j + 1;
      if (stripped[i] === ',') i += 1;
    } else {
      const next = stripped.indexOf(',', i);
      const end = next === -1 ? stripped.length : next;
      items.push(stripped.slice(i, end));
      i = next === -1 ? stripped.length : next + 1;
    }
  }
  return items;
};

const makeColumnPredicate = (column: string, opAndValue: string): Predicate => {
  const dotIdx = opAndValue.indexOf('.');
  if (dotIdx === -1) throw new Error(`invalid filter: ${column}=${opAndValue}`);
  const op = opAndValue.slice(0, dotIdx);
  const value = opAndValue.slice(dotIdx + 1);
  switch (op) {
    case 'eq':
      return row => String((row as unknown as Record<string, unknown>)[column] ?? '') === value;
    case 'neq':
      return row => String((row as unknown as Record<string, unknown>)[column] ?? '') !== value;
    case 'in': {
      const items = parseInList(value);
      return row => items.includes(String((row as unknown as Record<string, unknown>)[column] ?? ''));
    }
    default:
      throw new Error(`unsupported operator: ${op}`);
  }
};

const makeOrPredicate = (orValue: string): Predicate => {
  const inner = orValue.replace(/^\(|\)$/g, '');
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  const predicates = parts.map(part => {
    const dotIdx = part.indexOf('.');
    const column = part.slice(0, dotIdx);
    const opAndValue = part.slice(dotIdx + 1);
    return makeColumnPredicate(column, opAndValue);
  });
  return row => predicates.some(p => p(row));
};

const createMockPostgrest = () => {
  const rows = new Map<string, Row>();
  let idCounter = 0;
  const newId = (): string => `row-${++idCounter}`;

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    });

  const evalFilters = (params: URLSearchParams): Row[] => {
    const predicates: Predicate[] = [];
    for (const [key, value] of params) {
      if (key === 'limit' || key === 'order') continue;
      if (key === 'or') {
        predicates.push(makeOrPredicate(value));
      } else {
        predicates.push(makeColumnPredicate(key, value));
      }
    }
    return [...rows.values()].filter(r => predicates.every(p => p(r)));
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const expected = `/rest/v1/${TABLE}`;
    if (url.pathname !== expected) return new Response('not found', { status: 404 });

    if (method === 'GET') {
      try {
        const matched = evalFilters(url.searchParams);
        const limit = Number(url.searchParams.get('limit') ?? '0');
        const sliced = limit > 0 ? matched.slice(0, limit) : matched;
        return json(sliced);
      } catch (error) {
        return json({ message: (error as Error).message }, { status: 400 });
      }
    }

    if (method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '[]') as Row[];
      const created: Row[] = [];
      const nowIso = new Date().toISOString();
      for (const partial of body) {
        if (!partial.Path) return json({ message: 'Path is required' }, { status: 400 });
        if (rows.has(partial.Path)) {
          return json(
            { message: `duplicate key value violates unique constraint on Path: ${partial.Path}` },
            { status: 409 },
          );
        }
        const row: Row = { ...partial, id: newId(), created_at: nowIso, updated_at: nowIso };
        rows.set(row.Path, row);
        created.push(row);
      }
      return json(created);
    }

    if (method === 'PATCH') {
      const patch = JSON.parse((init?.body as string) ?? '{}') as Partial<Row>;
      const matched = evalFilters(url.searchParams);
      const nowIso = new Date().toISOString();
      const updated = matched.map(r => {
        const next: Row = { ...r, ...patch, updated_at: patch.updated_at ?? nowIso };
        rows.set(next.Path, next);
        return next;
      });
      return json(updated);
    }

    if (method === 'DELETE') {
      const matched = evalFilters(url.searchParams);
      for (const r of matched) rows.delete(r.Path);
      return json(matched);
    }

    return new Response(`{"unhandled":"${method}"}`, { status: 501 });
  };

  return { rows, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const postgrestContractCase: StorageContractCase = {
  name: 'PostgrestStorageRepository',
  async makeRepo() {
    const mock = createMockPostgrest();
    return new PostgrestStorageRepository({
      url: URL_BASE,
      tableName: TABLE,
      auth: { anonKey: ANON },
      fetch: mock.fetch,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
