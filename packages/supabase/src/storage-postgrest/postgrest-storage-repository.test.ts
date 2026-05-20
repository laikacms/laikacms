import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PostgrestStorageRepository } from './postgrest-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory PostgREST mock. The interesting part: faithfully evaluating the
// subset of PostgREST's filter DSL the repository emits.
//
//   ?Parent=eq.notes                  → Parent === 'notes'
//   ?Type=eq.file&Parent=eq.foo       → both (implicit AND)
//   ?Path=in.("a","b","c")            → Path ∈ {a, b, c}
//   ?or=(Name.eq.x,Name.eq.y)         → Name === 'x' OR Name === 'y'
// ---------------------------------------------------------------------------

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

// ---- Filter evaluator ----------------------------------------------------

type Predicate = (row: Row) => boolean;

const parseInList = (value: string): string[] => {
  // value is "(a,b,c)" or "(\"a\",\"b\",\"c\")"
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
      return (row) => String((row as Record<string, unknown>)[column] ?? '') === value;
    case 'neq':
      return (row) => String((row as Record<string, unknown>)[column] ?? '') !== value;
    case 'in': {
      const items = parseInList(value);
      return (row) => items.includes(String((row as Record<string, unknown>)[column] ?? ''));
    }
    default:
      throw new Error(`unsupported operator: ${op}`);
  }
};

const makeOrPredicate = (orValue: string): Predicate => {
  // orValue is "(col1.op.val,col2.op.val,...)" — wrapped in parens.
  const inner = orValue.replace(/^\(|\)$/g, '');
  // We need to split on top-level commas. PostgREST's grammar for OR
  // doesn't nest in the patterns the repository emits, so a simple split
  // is enough — but be careful about commas inside quoted strings.
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
  return (row) => predicates.some(p => p(row));
};

const createMockPostgrest = () => {
  const rows = new Map<string, Row>();
  let idCounter = 0;
  const newId = (): string => `row-${++idCounter}`;
  let lastApikey: string | undefined;

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

    lastApikey = (init?.headers as Record<string, string> | undefined)?.['apikey'];

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
          return json({ message: `duplicate key value violates unique constraint on Path: ${partial.Path}` }, {
            status: 409,
          });
        }
        const row: Row = {
          ...partial,
          id: newId(),
          created_at: nowIso,
          updated_at: nowIso,
        };
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

  return { rows, fetch: fetchImpl, lastApikey: () => lastApikey };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockPostgrest>;

beforeEach(() => { mock = createMockPostgrest(); });
afterEach(() => { mock.rows.clear(); });

const makeRepo = () =>
  new PostgrestStorageRepository({
    url: URL_BASE,
    tableName: TABLE,
    auth: { anonKey: ANON },
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

describe('PostgrestStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    const onWire = mock.rows.get('hello');
    expect(onWire?.Content).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(mock.rows.get('hello')?.Content).toBe('updated');

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(mock.rows.has('hello')).toBe(false);
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

  it('auto-creates ancestor folder rows for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    const folders = [...mock.rows.values()].filter(r => r.Type === 'folder').map(r => r.Path).sort();
    expect(folders).toEqual(['a', 'a/b']);
    expect(mock.rows.get('a/b/c')?.Content).toBe('deep');
  });
});

describe('PostgrestStorageRepository removeAtoms uses one IN-list DELETE', () => {
  it('packs multiple deletes into a single Path=in.(…) request', async () => {
    const repo = makeRepo();
    // Seed three files via three creates.
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'c', content: { body: 'c' } }));

    // Count DELETE calls during the batch removeAtoms.
    let deleteCalls = 0;
    const innerFetch = mock.fetch;
    const wrapped: typeof fetch = async (input, init) => {
      if ((init?.method ?? 'GET') === 'DELETE') deleteCalls += 1;
      return innerFetch(input, init);
    };
    const wrappedRepo = new PostgrestStorageRepository({
      url: URL_BASE,
      tableName: TABLE,
      auth: { anonKey: ANON },
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

    const removed = await LaikaStream.runPromiseCollect(wrappedRepo.removeAtoms(['a', 'b', 'c']));

    expect(removed.data.sort()).toEqual(['a', 'b', 'c']);
    expect(deleteCalls).toBe(1);
    expect(mock.rows.size).toBe(0);
  });
});

describe('PostgrestStorageRepository listing', () => {
  it('classifies files as object-summary and folders as folder-summary', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'top', content: { body: 'x' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('sorts numeric filenames naturally', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '1', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '10', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '2', content: { body: 'c' } }));

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

describe('PostgrestStorageRepository auth headers', () => {
  it('sends `apikey` on every request', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'h', content: { body: 'x' } }));
    expect(mock.lastApikey()).toBe(ANON);
  });
});

describe('PostgrestStorageRepository folder semantics', () => {
  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect(mock.rows.get('notes')?.Type).toBe('folder');
  });

  it('refuses to delete the storage root', async () => {
    const attempt = await LaikaStream.runPromiseCollect(makeRepo().removeAtoms(['']));
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
  });
});
