import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { AIRTABLE_BATCH_LIMIT, type AirtableRecord } from '../airtable-datasource.js';
import { AirtableStorageRepository } from '../airtable-storage-repository.js';

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
  [key: string]: unknown;
}

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

const createMockAirtable = () => {
  const records = new Map<string, AirtableRecord<Fields>>();
  let idCounter = 0;
  const newId = (): string => `rec${(++idCounter).toString().padStart(14, '0')}`;

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
      const body = JSON.parse((init?.body as string) ?? '{}') as { records: Array<{ fields: Fields }> };
      if (body.records.length > AIRTABLE_BATCH_LIMIT) return new Response('too many', { status: 422 });
      const created: AirtableRecord<Fields>[] = body.records.map(r => {
        const id = newId();
        const record: AirtableRecord<Fields> = { id, createdTime: new Date().toISOString(), fields: r.fields };
        records.set(id, record);
        return record;
      });
      return json({ records: created });
    }

    if (method === 'PATCH') {
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        records: Array<{ id: string, fields: Partial<Fields> }>,
      };
      if (body.records.length > AIRTABLE_BATCH_LIMIT) return new Response('too many', { status: 422 });
      const updated: AirtableRecord<Fields>[] = body.records.map(r => {
        const existing = records.get(r.id);
        if (!existing) throw new Error(`missing ${r.id}`);
        const next: AirtableRecord<Fields> = { ...existing, fields: { ...existing.fields, ...r.fields } };
        records.set(r.id, next);
        return next;
      });
      return json({ records: updated });
    }

    if (method === 'DELETE') {
      const ids = url.searchParams.getAll('records[]');
      if (ids.length > AIRTABLE_BATCH_LIMIT) return new Response('too many', { status: 422 });
      const result: Array<{ id: string, deleted: boolean }> = ids.map(id => {
        const had = records.delete(id);
        return { id, deleted: had };
      });
      return json({ records: result });
    }

    return new Response(`{"unhandled":"${method}"}`, { status: 501 });
  };

  return { records, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const airtableContractCase: StorageContractCase = {
  name: 'AirtableStorageRepository',
  async makeRepo() {
    const mock = createMockAirtable();
    return new AirtableStorageRepository({
      baseId: BASE_ID,
      tableName: TABLE,
      auth: { token: 'pat-test' },
      apiUrl: API_URL,
      fetch: mock.fetch,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
