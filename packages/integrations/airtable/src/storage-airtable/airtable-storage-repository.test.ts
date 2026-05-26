import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AIRTABLE_BATCH_LIMIT, type AirtableRecord, escapeAirtableString } from './airtable-datasource.js';
import { AirtableStorageRepository } from './airtable-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory Airtable mock. The interesting bits to verify:
//   - filterByFormula evaluation (the subset the repository emits)
//   - the 10-record batch cap (chunking must produce ⌈n/10⌉ HTTP calls)
//   - DELETE with `records[]=...` repeated form
// ---------------------------------------------------------------------------

const BASE_ID = 'appBASE';
const TABLE = 'laika_storage';
const API_URL = 'https://mock.airtable.test/v0';

interface Fields {
  Parent: string;
  Name: string;
  Path: string;
  Type: 'file' | 'folder';
  Extension?: string;
  Content?: string;
}

// ---- Filter formula parser/evaluator -----------------------------------
//
// We support the exact formula shapes the repository emits:
//   {Field} = "literal"
//   AND(<expr>, <expr>, ...)
//   OR(<expr>, <expr>, ...)
//
// Anything outside that grammar produces an explicit parse error so the
// mock surfaces formula-shape mistakes during testing.

type Expr =
  | { kind: 'cmp', field: string, value: string }
  | { kind: 'and', children: Expr[] }
  | { kind: 'or', children: Expr[] };

class FormulaParser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): Expr {
    const expr = this.parseExpr();
    this.skipWs();
    if (this.i < this.s.length) throw new Error(`unexpected trailing: ${this.s.slice(this.i)}`);
    return expr;
  }
  private parseExpr(): Expr {
    this.skipWs();
    if (this.peek('AND(')) return this.parseFn('and', 4);
    if (this.peek('OR(')) return this.parseFn('or', 3);
    return this.parseCmp();
  }
  private parseFn(kind: 'and' | 'or', skip: number): Expr {
    this.i += skip;
    const children: Expr[] = [];
    while (true) {
      children.push(this.parseExpr());
      this.skipWs();
      if (this.s[this.i] === ',') {
        this.i += 1;
        continue;
      }
      if (this.s[this.i] === ')') {
        this.i += 1;
        break;
      }
      throw new Error(`expected , or ) at ${this.i}`);
    }
    return { kind, children };
  }
  private parseCmp(): Expr {
    this.skipWs();
    if (this.s[this.i] !== '{') throw new Error(`expected { at ${this.i}`);
    const close = this.s.indexOf('}', this.i);
    if (close === -1) throw new Error('unterminated {field}');
    const field = this.s.slice(this.i + 1, close);
    this.i = close + 1;
    this.skipWs();
    if (this.s[this.i] !== '=') throw new Error(`expected = at ${this.i}`);
    this.i += 1;
    this.skipWs();
    const value = this.parseString();
    return { kind: 'cmp', field, value };
  }
  private parseString(): string {
    if (this.s[this.i] !== '"') throw new Error(`expected " at ${this.i}`);
    this.i += 1;
    let out = '';
    while (this.i < this.s.length) {
      if (this.s[this.i] === '"') {
        if (this.s[this.i + 1] === '"') {
          out += '"';
          this.i += 2;
          continue;
        }
        this.i += 1;
        return out;
      }
      out += this.s[this.i];
      this.i += 1;
    }
    throw new Error('unterminated string');
  }
  private skipWs() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i += 1;
  }
  private peek(t: string): boolean {
    this.skipWs();
    return this.s.startsWith(t, this.i);
  }
}

const evalExpr = (expr: Expr, fields: Fields): boolean => {
  if (expr.kind === 'and') return expr.children.every(c => evalExpr(c, fields));
  if (expr.kind === 'or') return expr.children.some(c => evalExpr(c, fields));
  const fieldValue = (fields as Record<string, unknown>)[expr.field];
  return (fieldValue ?? '') === expr.value;
};

// ---- Mock --------------------------------------------------------------

const createMockAirtable = () => {
  const records = new Map<string, AirtableRecord<Fields>>();
  let idCounter = 0;
  const newId = (): string => `rec${(++idCounter).toString().padStart(14, '0')}`;
  let createCalls = 0;
  let updateCalls = 0;
  let deleteCalls = 0;

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const expected = `/v0/${BASE_ID}/${TABLE}`;
    if (url.pathname !== expected) return new Response('not found', { status: 404 });

    if (method === 'GET') {
      const formula = url.searchParams.get('filterByFormula') ?? '';
      let matching: AirtableRecord<Fields>[];
      try {
        if (formula === '') {
          matching = [...records.values()];
        } else {
          const parsed = new FormulaParser(formula).parse();
          matching = [...records.values()].filter(r => evalExpr(parsed, r.fields));
        }
      } catch (error) {
        return new Response(
          JSON.stringify({ error: { message: `formula parse failed: ${(error as Error).message}` } }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return json({ records: matching });
    }

    if (method === 'POST') {
      createCalls += 1;
      const body = JSON.parse((init?.body as string) ?? '{}') as { records: Array<{ fields: Fields }> };
      if (body.records.length > AIRTABLE_BATCH_LIMIT) {
        return new Response('too many', { status: 422 });
      }
      const created: AirtableRecord<Fields>[] = body.records.map(r => {
        const id = newId();
        const record: AirtableRecord<Fields> = {
          id,
          createdTime: new Date().toISOString(),
          fields: r.fields,
        };
        records.set(id, record);
        return record;
      });
      return json({ records: created });
    }

    if (method === 'PATCH') {
      updateCalls += 1;
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        records: Array<{ id: string, fields: Partial<Fields> }>,
      };
      if (body.records.length > AIRTABLE_BATCH_LIMIT) {
        return new Response('too many', { status: 422 });
      }
      const updated: AirtableRecord<Fields>[] = body.records.map(r => {
        const existing = records.get(r.id);
        if (!existing) throw new Error(`missing ${r.id}`);
        const next: AirtableRecord<Fields> = {
          ...existing,
          fields: { ...existing.fields, ...r.fields },
        };
        records.set(r.id, next);
        return next;
      });
      return json({ records: updated });
    }

    if (method === 'DELETE') {
      deleteCalls += 1;
      const ids = url.searchParams.getAll('records[]');
      if (ids.length > AIRTABLE_BATCH_LIMIT) {
        return new Response('too many', { status: 422 });
      }
      const result: Array<{ id: string, deleted: boolean }> = ids.map(id => {
        const had = records.delete(id);
        return { id, deleted: had };
      });
      return json({ records: result });
    }

    return new Response(`{"unhandled":"${method}"}`, { status: 501 });
  };

  return {
    records,
    fetch: fetchImpl,
    createCalls: () => createCalls,
    updateCalls: () => updateCalls,
    deleteCalls: () => deleteCalls,
  };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let mock: ReturnType<typeof createMockAirtable>;

beforeEach(() => {
  mock = createMockAirtable();
});
afterEach(() => {
  mock.records.clear();
});

const makeRepo = () =>
  new AirtableStorageRepository({
    baseId: BASE_ID,
    tableName: TABLE,
    auth: { token: 'pat-test' },
    apiUrl: API_URL,
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

describe('escapeAirtableString', () => {
  it("doubles embedded double-quotes (Airtable's escape rule)", () => {
    expect(escapeAirtableString('hello')).toBe('"hello"');
    expect(escapeAirtableString('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeAirtableString('')).toBe('""');
  });
});

describe('AirtableStorageRepository CRUD', () => {
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

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect([...mock.records.values()].some(r => r.fields.Name === 'hello.md')).toBe(false);
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

  it('auto-creates ancestor folder records for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );

    const folders = [...mock.records.values()]
      .filter(r => r.fields.Type === 'folder')
      .map(r => r.fields.Path)
      .sort();
    expect(folders).toEqual(['a', 'a/b']);
    expect([...mock.records.values()].some(r => r.fields.Type === 'file' && r.fields.Path === 'a/b/c')).toBe(true);
  });
});

describe('AirtableStorageRepository batch chunking', () => {
  it('chunks `removeAtoms` over 10 keys into ⌈N/10⌉ HTTP DELETE calls', async () => {
    const repo = makeRepo();
    // Seed 25 records (single creates → 25 POST calls; that's fine, the
    // chunking we want to verify is on the DELETE side).
    const keys = Array.from({ length: 25 }, (_, i) => `item-${i}`);
    for (const key of keys) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key, content: { body: `c-${key}` } }),
      );
    }
    expect(mock.records.size).toBe(25);

    const callsBefore = mock.deleteCalls();
    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(keys));
    const callsAfter = mock.deleteCalls();

    expect(removed.data.length).toBe(25);
    expect(removed.done).toEqual({ removed: 25, skipped: 0 });
    expect(mock.records.size).toBe(0);
    // 25 keys / 10 per batch = 3 HTTP DELETE calls (10 + 10 + 5).
    expect(callsAfter - callsBefore).toBe(3);
  });
});

describe('AirtableStorageRepository listing', () => {
  it('classifies files as object-summary (extension stripped) and folders as folder-summary', async () => {
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
