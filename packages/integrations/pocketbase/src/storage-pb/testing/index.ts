import type { StorageContractCase } from 'laikacms/storage/testing';

import { PocketBaseStorageRepository } from '../pocketbase-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory PocketBase mock — per-instance state so every makeRepo() call
// gets a fully isolated record store.
// ---------------------------------------------------------------------------

interface PbRecord {
  id: string;
  collectionName: string;
  created: string;
  updated: string;
  [key: string]: unknown;
}

const COLLECTION = 'laika_storage';
const URL_BASE = 'https://mock.pb.contract.test';

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
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i += 1;
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

const evalExpr = (expr: Expr, record: PbRecord): boolean => {
  if (expr.kind === 'and') return evalExpr(expr.left, record) && evalExpr(expr.right, record);
  if (expr.kind === 'or') return evalExpr(expr.left, record) || evalExpr(expr.right, record);
  const recordValue = record[expr.field];
  const lhs = recordValue === undefined ? '' : String(recordValue);
  return expr.op === '=' ? lhs === expr.value : lhs !== expr.value;
};

const matchFilter = (filter: string, record: PbRecord): boolean => {
  if (filter === '') return true;
  const parsed = new FilterParser(filter).parse();
  return evalExpr(parsed, record);
};

const createMockPb = () => {
  const records = new Map<string, PbRecord>();
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

    if (tail === '' && method === 'GET') {
      const filter = url.searchParams.get('filter') ?? '';
      const page = Number(url.searchParams.get('page') ?? '1');
      const perPage = Number(url.searchParams.get('perPage') ?? '30');
      let matched: PbRecord[];
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

    if (tail === '' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      const id = newId();
      const now = new Date().toISOString();
      const record: PbRecord = { id, collectionName: COLLECTION, created: now, updated: now, ...body };
      records.set(id, record);
      return json(record);
    }

    const recordMatch = tail.match(/^\/([^/]+)$/);
    if (recordMatch) {
      const id = decodeURIComponent(recordMatch[1]!);
      const existing = records.get(id);
      if (method === 'GET') {
        if (!existing) return json({ message: 'not found' }, { status: 404 });
        return json(existing);
      }
      if (method === 'PATCH') {
        if (!existing) return json({ message: 'not found' }, { status: 404 });
        const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
        const updated: PbRecord = { ...existing, ...body, updated: new Date().toISOString() };
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

  return fetchImpl;
};

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

export const pocketbaseContractCase: StorageContractCase = {
  name: 'PocketBaseStorageRepository',
  async makeRepo(): Promise<PocketBaseStorageRepository> {
    const fetchImpl = createMockPb();
    return new PocketBaseStorageRepository({
      url: URL_BASE,
      auth: { token: 'pb-contract-jwt' },
      fetch: fetchImpl,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
