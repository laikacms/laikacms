import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pocketbaseContractCase } from './testing/index.js';

import { PocketBaseStorageRepository } from './pocketbase-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory PocketBase mock. The trickiest bit is faithfully evaluating
// PocketBase's filter syntax — we ship a small recursive-descent parser for
// the subset the repository emits (`=`, `!=`, `&&`, `||`, parens, quoted
// literals). Matches the wire shape PocketBase itself documents.
// ---------------------------------------------------------------------------

interface Record {
  id: string;
  collectionName: string;
  created: string;
  updated: string;
  parent?: string;
  name?: string;
  path?: string;
  type?: string;
  extension?: string;
  content?: string;
  [key: string]: unknown;
}

const COLLECTION = 'laika_storage';
const URL_BASE = 'https://mock.pb.test';

// ---- Filter parser/evaluator ------------------------------------------

type Expr =
  | { kind: 'cmp', field: string, op: '=' | '!=', value: string }
  | { kind: 'and', left: Expr, right: Expr }
  | { kind: 'or', left: Expr, right: Expr };

class FilterParser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): Expr {
    const expr = this.parseOr();
    this.skipWs();
    if (this.i < this.s.length) throw new Error(`unexpected trailing: ${this.s.slice(this.i)}`);
    return expr;
  }
  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.consume('||')) {
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }
  private parseAnd(): Expr {
    let left = this.parseAtom();
    while (this.consume('&&')) {
      const right = this.parseAtom();
      left = { kind: 'and', left, right };
    }
    return left;
  }
  private parseAtom(): Expr {
    this.skipWs();
    if (this.consume('(')) {
      const inner = this.parseOr();
      this.skipWs();
      if (!this.consume(')')) throw new Error('expected )');
      return inner;
    }
    // identifier op "value"
    const field = this.parseIdent();
    this.skipWs();
    const op = this.consume('!=') ? '!=' : this.consume('=') ? '=' : '';
    if (op === '') throw new Error(`expected = or != at ${this.i}`);
    this.skipWs();
    const value = this.parseString();
    return { kind: 'cmp', field, op, value };
  }
  private parseIdent(): string {
    this.skipWs();
    const m = this.s.slice(this.i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!m) throw new Error(`expected identifier at ${this.i}`);
    this.i += m[0].length;
    return m[0];
  }
  private parseString(): string {
    if (this.s[this.i] !== '"') throw new Error(`expected " at ${this.i}`);
    this.i += 1;
    let out = '';
    while (this.i < this.s.length && this.s[this.i] !== '"') {
      if (this.s[this.i] === '\\') {
        out += this.s[this.i + 1] ?? '';
        this.i += 2;
      } else {
        out += this.s[this.i];
        this.i += 1;
      }
    }
    if (this.s[this.i] !== '"') throw new Error('unterminated string');
    this.i += 1;
    return out;
  }
  private skipWs() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i += 1;
  }
  private consume(token: string): boolean {
    this.skipWs();
    if (this.s.startsWith(token, this.i)) {
      this.i += token.length;
      return true;
    }
    return false;
  }
}

const evalExpr = (expr: Expr, record: Record): boolean => {
  if (expr.kind === 'and') return evalExpr(expr.left, record) && evalExpr(expr.right, record);
  if (expr.kind === 'or') return evalExpr(expr.left, record) || evalExpr(expr.right, record);
  const recordValue = record[expr.field];
  const lhs = recordValue === undefined ? '' : String(recordValue);
  return expr.op === '=' ? lhs === expr.value : lhs !== expr.value;
};

const matchFilter = (filter: string, record: Record): boolean => {
  if (filter === '') return true;
  const parsed = new FilterParser(filter).parse();
  return evalExpr(parsed, record);
};

// ---- Mock ------------------------------------------------------------

const createMockPb = () => {
  const records = new Map<string, Record>();
  let idCounter = 0;
  const newId = (): string => `r${(++idCounter).toString().padStart(14, '0')}`;

  const json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const prefix = `/api/collections/${COLLECTION}/records`;
    if (!url.pathname.startsWith(prefix)) return new Response('not found', { status: 404 });
    const tail = url.pathname.slice(prefix.length);

    // GET /records — paginated list
    if (tail === '' && method === 'GET') {
      const filter = url.searchParams.get('filter') ?? '';
      const page = Number(url.searchParams.get('page') ?? '1');
      const perPage = Number(url.searchParams.get('perPage') ?? '30');
      let matched: Record[];
      try {
        matched = [...records.values()].filter(r => matchFilter(filter, r));
      } catch (error) {
        return json({ message: `bad filter: ${(error as Error).message}` }, { status: 400 });
      }
      const start = (page - 1) * perPage;
      const items = matched.slice(start, start + perPage);
      return json({
        items,
        page,
        perPage,
        totalItems: matched.length,
        totalPages: Math.max(1, Math.ceil(matched.length / perPage)),
      });
    }

    // POST /records — create
    if (tail === '' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      const id = newId();
      const now = new Date().toISOString();
      const record: Record = {
        id,
        collectionName: COLLECTION,
        created: now,
        updated: now,
        ...body,
      };
      records.set(id, record);
      return json(record);
    }

    // PATCH / DELETE / GET /records/{id}
    const recordMatch = tail.match(/^\/([^/]+)$/);
    if (recordMatch) {
      const id = decodeURIComponent(recordMatch[1]);
      const existing = records.get(id);
      if (method === 'GET') {
        if (!existing) return json({ message: 'not found' }, { status: 404 });
        return json(existing);
      }
      if (method === 'PATCH') {
        if (!existing) return json({ message: 'not found' }, { status: 404 });
        const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
        const updated: Record = { ...existing, ...body, updated: new Date().toISOString() };
        records.set(id, updated);
        return json(updated);
      }
      if (method === 'DELETE') {
        records.delete(id);
        return new Response(null, { status: 204 });
      }
    }

    return new Response(`{"unhandled":"${method} ${url.pathname}"}`, { status: 501 });
  };

  return { records, fetch: fetchImpl };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockPb>;

beforeEach(() => {
  mock = createMockPb();
});
afterEach(() => {
  mock.records.clear();
});

const makeRepo = () =>
  new PocketBaseStorageRepository({
    url: URL_BASE,
    auth: { token: 'pb-test-jwt' },
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
// Tests — start with a parser sanity check, then the repository behaviours.
// ---------------------------------------------------------------------------

describe('PocketBase filter parser (mock)', () => {
  it('parses and evaluates the exact filter shapes the repository emits', () => {
    const record = {
      id: '1',
      collectionName: COLLECTION,
      created: '',
      updated: '',
      parent: 'notes',
      name: 'a.md',
      type: 'file',
      path: 'notes/a',
    };
    expect(matchFilter('parent = "notes"', record)).toBe(true);
    expect(matchFilter('parent = "other"', record)).toBe(false);
    expect(matchFilter('type = "file" && parent = "notes"', record)).toBe(true);
    expect(matchFilter('type = "file" && parent = "notes" && (name = "a.md" || name = "b.md")', record)).toBe(true);
    expect(matchFilter('type = "file" && parent = "notes" && (name = "x.md" || name = "y.md")', record)).toBe(false);
    expect(matchFilter('path = "notes/a"', record)).toBe(true);
  });
});

describe('PocketBaseStorageRepository CRUD', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    const onWire = [...mock.records.values()].find(r => r.name === 'hello.md');
    expect(onWire?.content).toBe('hi');

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect([...mock.records.values()].some(r => r.name === 'hello.md')).toBe(false);
  });

  it('auto-creates ancestor folder records for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    const all = [...mock.records.values()];
    const folders = all.filter(r => r.type === 'folder').map(r => r.path).sort();
    const files = all.filter(r => r.type === 'file').map(r => r.path);
    expect(folders).toEqual(['a', 'a/b']);
    expect(files).toEqual(['a/b/c']);
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

describe('PocketBaseStorageRepository listing', () => {
  it('classifies records correctly and sorts numerically', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '1', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '10', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '2', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', 'notes']);
    const types = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(types['notes']).toBe('folder-summary');
    expect(types['1']).toBe('object-summary');
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

describe('PocketBaseStorageRepository folder semantics', () => {
  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect([...mock.records.values()].some(r => r.type === 'folder' && r.path === 'notes')).toBe(true);
  });

  it('refuses to delete the storage root', async () => {
    const attempt = await LaikaStream.runPromiseCollect(makeRepo().removeAtoms(['']));
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
  });
});

runStorageRepositoryContract(pocketbaseContractCase);
