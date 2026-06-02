import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { type SurqlStatementResult, SurrealDbDataSource } from '../surrealdb-datasource.js';
import { SurrealDbStorageRepository } from '../surrealdb-storage-repository.js';

const API = 'http://surreal.test:8000';
const NS = 'cms_ns';
const DB = 'cms_db';
const TOKEN = 'surreal_test_jwt';

interface Record_ {
  id: string;
  path: string;
  parent: string;
  name: string;
  extension?: string;
  content?: string;
  type: 'file' | 'folder';
  createdAt: string;
  updatedAt: string;
}

const makeId = (table: string, path: string): string => `${table}:${path}`;

interface ExecuteCtx {
  vars: Record<string, unknown>;
  insideTransaction: boolean;
}

const result = (status: 'OK' | 'ERR', value: unknown): SurqlStatementResult => ({
  status,
  time: '1ms',
  result: value,
});

const createMockSurrealDb = () => {
  const store = new Map<string, Record_>();

  const evalStatement = (stmt: string, ctx: ExecuteCtx): SurqlStatementResult => {
    const trimmed = stmt.replace(/\s+/g, ' ').trim();
    if (trimmed === '') return result('OK', null);

    if (/^BEGIN TRANSACTION$/i.test(trimmed)) return result('OK', null);
    if (/^COMMIT TRANSACTION$/i.test(trimmed)) return result('OK', null);

    let m = trimmed.match(/^CREATE type::thing\(\$(\w+), \$(\w+)\) CONTENT \$(\w+)$/i);
    if (m) {
      const table = String(ctx.vars[m[1]!]);
      const path = String(ctx.vars[m[2]!]);
      const value = ctx.vars[m[3]!] as Omit<Record_, 'id'>;
      const id = makeId(table, path);
      if (store.has(id)) {
        return result(
          'ERR',
          `There was a problem with the database: Database record already exists for ${id} (UNIQUE constraint)`,
        );
      }
      store.set(id, { ...value, id });
      return result('OK', [{ ...value, id }]);
    }

    m = trimmed.match(/^UPSERT type::thing\(\$(\w+), \$(\w+)\) CONTENT \$(\w+)$/i);
    if (m) {
      const table = String(ctx.vars[m[1]!]);
      const path = String(ctx.vars[m[2]!]);
      const value = ctx.vars[m[3]!] as Omit<Record_, 'id'>;
      const id = makeId(table, path);
      store.set(id, { ...value, id });
      return result('OK', [{ ...value, id }]);
    }

    m = trimmed.match(/^UPDATE type::thing\(\$(\w+), \$(\w+)\) MERGE \$(\w+)$/i);
    if (m) {
      const table = String(ctx.vars[m[1]!]);
      const path = String(ctx.vars[m[2]!]);
      const merge = ctx.vars[m[3]!] as Partial<Record_>;
      const id = makeId(table, path);
      const existing = store.get(id);
      if (!existing) return result('OK', []);
      const merged = { ...existing, ...merge };
      store.set(id, merged);
      return result('OK', [merged]);
    }

    m = trimmed.match(/^DELETE type::thing\(\$(\w+), \$(\w+)\)$/i);
    if (m) {
      const table = String(ctx.vars[m[1]!]);
      const path = String(ctx.vars[m[2]!]);
      const id = makeId(table, path);
      const had = store.delete(id);
      return result('OK', had ? [{ id }] : []);
    }

    m = trimmed.match(/^SELECT \* FROM (\w+) WHERE type = "file" AND parent = \$(\w+) AND name = \$(\w+) LIMIT 1$/i);
    if (m) {
      const table = m[1]!;
      const parent = String(ctx.vars[m[2]!]);
      const name = String(ctx.vars[m[3]!]);
      const matched = [...store.values()].filter(
        r => r.id.startsWith(`${table}:`) && r.type === 'file' && r.parent === parent && r.name === name,
      );
      return result('OK', matched.slice(0, 1));
    }

    m = trimmed.match(/^SELECT \* FROM (\w+) WHERE parent = \$(\w+)$/i);
    if (m) {
      const table = m[1]!;
      const parent = String(ctx.vars[m[2]!]);
      const matched = [...store.values()].filter(
        r => r.id.startsWith(`${table}:`) && r.parent === parent,
      );
      return result('OK', matched);
    }

    m = trimmed.match(/^SELECT id FROM (\w+) WHERE path = \$(\w+) LIMIT 1$/i);
    if (m) {
      const table = m[1]!;
      const path = String(ctx.vars[m[2]!]);
      const matched = [...store.values()].filter(r => r.id.startsWith(`${table}:`) && r.path === path);
      return result('OK', matched.slice(0, 1));
    }

    m = trimmed.match(/^SELECT id FROM (\w+) WHERE parent = \$(\w+) LIMIT 1$/i);
    if (m) {
      const table = m[1]!;
      const parent = String(ctx.vars[m[2]!]);
      const matched = [...store.values()].filter(r => r.id.startsWith(`${table}:`) && r.parent === parent);
      return result('OK', matched.slice(0, 1));
    }

    m = trimmed.match(/^SELECT id FROM (\w+) LIMIT 1$/i);
    if (m) {
      const table = m[1]!;
      const matched = [...store.values()].filter(r => r.id.startsWith(`${table}:`));
      return result('OK', matched.slice(0, 1));
    }

    return result('ERR', `mock: unrecognised SurQL: ${trimmed.slice(0, 100)}`);
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (!url.startsWith(API)) return new Response('not found', { status: 404 });
    const u = new URL(url);
    if (u.pathname !== '/sql' || (init?.method ?? 'GET').toUpperCase() !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    const h = (init?.headers ?? {}) as Record<string, string>;
    if (h['Authorization'] !== `Bearer ${TOKEN}`) return new Response('Unauthorized', { status: 401 });
    if (h['NS'] !== NS || h['DB'] !== DB) return new Response('Bad request: missing NS/DB', { status: 400 });

    const vars: Record<string, unknown> = {};
    for (const [k, v] of u.searchParams) {
      try {
        vars[k] = JSON.parse(v);
      } catch {
        vars[k] = v;
      }
    }

    const surql = init?.body as string;
    const stmts = surql.split(';').map(s => s.trim()).filter(s => s.length > 0);

    let insideTxn = false;
    const results: SurqlStatementResult[] = [];
    for (const stmt of stmts) {
      const isBegin = /^BEGIN TRANSACTION$/i.test(stmt);
      const isCommit = /^COMMIT TRANSACTION$/i.test(stmt);
      const ctx = { vars, insideTransaction: insideTxn };
      results.push(evalStatement(stmt, ctx));
      if (isBegin) insideTxn = true;
      if (isCommit) insideTxn = false;
    }

    return new Response(JSON.stringify(results), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  return { store, fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const surrealdbContractCase: StorageContractCase = {
  name: 'SurrealDbStorageRepository',
  async makeRepo() {
    const mock = createMockSurrealDb();
    const ds = new SurrealDbDataSource({
      url: API,
      namespace: NS,
      database: DB,
      auth: { token: TOKEN },
      fetch: mock.fetch,
    });
    return new SurrealDbStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry() as never,
      defaultFileExtension: 'json',
    });
  },
};
