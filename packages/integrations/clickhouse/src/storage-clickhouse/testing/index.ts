import type { StorageContractCase } from 'laikacms/storage/testing';

import { ClickHouseDataSource, parseNdjson, serializeNdjson } from '../clickhouse-datasource.js';
import { ClickHouseStorageRepository } from '../clickhouse-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory ClickHouse mock.
//
// Honors the ClickHouse wire shape:
//   POST /?database=...&query=SELECT...FORMAT JSONEachRow   (empty body)
//   POST /?database=...&query=INSERT INTO t FORMAT JSONEachRow (NDJSON body)
//   POST /?database=...&query=DELETE FROM t WHERE ...        (empty body)
//
// Uses `param_<name>` URL parameters for ClickHouse parameterised queries.
// ---------------------------------------------------------------------------

const API_URL = 'http://ch-mock.test:8123';
const DATABASE = 'laika_test';

interface Row {
  path: string;
  parent: string;
  name: string;
  type: 'file' | 'folder';
  extension: string;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const substituteParams = (sql: string, params: Record<string, string>): string =>
  sql.replace(/\{(\w+):(\w+(?:\([^)]+\))?)\}/g, (_, name) => {
    const v = params[name as string];
    if (v === undefined) return `{${name}:UNBOUND}`;
    return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  });

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().replace(/\s+FORMAT\s+JSONEachRow$/i, '');

const createMockClickHouse = () => {
  // path → array of Row versions (highest version wins with FINAL semantics)
  const store = new Map<string, Row[]>();

  // Insertion sequence counter — used as tiebreaker when two rows share the
  // same version timestamp (can happen if Date.now() ticks at 1 ms precision).
  let insertionSeq = 0;
  const insertionIndex = new Map<Row, number>();

  const upsertRow = (row: Row): void => {
    const versions = store.get(row.path) ?? [];
    insertionIndex.set(row, insertionSeq++);
    versions.push(row);
    store.set(row.path, versions);
  };

  // ReplacingMergeTree FINAL semantics — highest version per path wins.
  // Insertion sequence breaks ties so the last-inserted row always wins.
  const finalRows = (): Row[] => {
    const out: Row[] = [];
    for (const versions of store.values()) {
      if (versions.length === 0) continue;
      const latest = [...versions].sort((a, b) => {
        const vDiff = b.version - a.version;
        if (vDiff !== 0) return vDiff;
        return (insertionIndex.get(b) ?? 0) - (insertionIndex.get(a) ?? 0);
      })[0]!;
      out.push(latest);
    }
    return out;
  };

  const evalSelect = (sql: string): Row[] | { c: number } => {
    const q = norm(sql);

    let m = q.match(/^SELECT count\(\) AS c FROM \w+ FINAL$/);
    if (m) return { c: finalRows().length };

    m = q.match(/^SELECT count\(\) AS c FROM \w+ FINAL WHERE parent = '([^']*)'$/);
    if (m) return { c: finalRows().filter(r => r.parent === m![1]).length };

    m = q.match(
      /^SELECT .+ FROM \w+ FINAL WHERE type = 'file' AND parent = '([^']*)' AND name = '([^']*)' LIMIT 1$/,
    );
    if (m) {
      const [, parent, name] = m;
      return finalRows().filter(r => r.type === 'file' && r.parent === parent && r.name === name).slice(0, 1);
    }

    m = q.match(/^SELECT \* FROM \w+ FINAL WHERE type = 'folder' AND path = '([^']*)' LIMIT 1$/);
    if (m) {
      return finalRows().filter(r => r.type === 'folder' && r.path === m![1]).slice(0, 1);
    }

    m = q.match(/^SELECT .+ FROM \w+ FINAL WHERE parent = '([^']*)'$/);
    if (m) return finalRows().filter(r => r.parent === m![1]);

    throw new Error(`mock: unrecognised SELECT: ${q.slice(0, 200)}`);
  };

  const evalDelete = (sql: string): void => {
    const q = norm(sql);
    const m = q.match(
      /^DELETE FROM \w+ WHERE type = 'file' AND path IN \(([^)]+)\) SETTINGS mutations_sync = 1$/,
    );
    if (!m) throw new Error(`mock: unrecognised DELETE: ${q.slice(0, 200)}`);
    const tupleSrc = m[1]!;
    const paths: string[] = [];
    let pos = 0;
    while (pos < tupleSrc.length) {
      while (pos < tupleSrc.length && /\s/.test(tupleSrc[pos]!)) pos += 1;
      if (tupleSrc[pos] === "'") {
        pos += 1;
        let value = '';
        while (pos < tupleSrc.length && tupleSrc[pos] !== "'") {
          if (tupleSrc[pos] === '\\') {
            value += tupleSrc[pos + 1];
            pos += 2;
          } else {
            value += tupleSrc[pos];
            pos += 1;
          }
        }
        paths.push(value);
        pos += 1;
      }
      while (pos < tupleSrc.length && tupleSrc[pos] !== "'") pos += 1;
    }
    for (const p of paths) store.delete(p);
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (!url.startsWith(API_URL)) return new Response('not found', { status: 404 });
    const u = new URL(url);
    if (u.pathname !== '/' || (init?.method ?? 'GET').toUpperCase() !== 'POST') {
      return new Response('not found', { status: 404 });
    }

    const rawSql = u.searchParams.get('query');
    if (!rawSql) return new Response('Bad request: missing query', { status: 400 });

    const params: Record<string, string> = {};
    for (const [k, v] of u.searchParams.entries()) {
      if (k.startsWith('param_')) params[k.slice(6)] = v;
    }
    const sql = substituteParams(rawSql, params);
    const body = (init?.body as string) ?? '';

    // INSERT — body is NDJSON
    const insertMatch = sql.match(/^INSERT INTO (\w+) FORMAT JSONEachRow$/);
    if (insertMatch) {
      const inserted = parseNdjson<Row>(body);
      for (const row of inserted) {
        upsertRow({
          path: String(row.path),
          parent: String(row.parent),
          name: String(row.name),
          type: row.type === 'folder' ? 'folder' : 'file',
          extension: String(row.extension ?? ''),
          content: String(row.content ?? ''),
          version: Number(row.version ?? Date.now()),
          createdAt: String(row.createdAt ?? new Date().toISOString()),
          updatedAt: String(row.updatedAt ?? new Date().toISOString()),
        });
      }
      return new Response('', { status: 200 });
    }

    // SELECT
    if (/^SELECT/i.test(sql)) {
      try {
        const result = evalSelect(sql);
        if ('c' in result) {
          return new Response(`${JSON.stringify(result)}\n`, {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson' },
          });
        }
        return new Response(
          serializeNdjson((result as unknown as Array<Record<string, unknown>>) ?? []) + '\n',
          { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
        );
      } catch (err) {
        return new Response((err as Error).message, { status: 400 });
      }
    }

    // DELETE
    if (/^DELETE/i.test(sql)) {
      try {
        evalDelete(sql);
        return new Response('', { status: 200 });
      } catch (err) {
        return new Response((err as Error).message, { status: 400 });
      }
    }

    return new Response(`mock: unsupported SQL: ${sql.slice(0, 100)}`, { status: 400 });
  };

  return { fetchImpl };
};

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

export const clickhouseContractCase: StorageContractCase = {
  name: 'ClickHouseStorageRepository',
  async makeRepo() {
    const { fetchImpl } = createMockClickHouse();
    const dataSource = new ClickHouseDataSource({
      url: API_URL,
      database: DATABASE,
      auth: { basic: { username: 'test', password: 'test' } },
      fetch: fetchImpl,
    });
    return new ClickHouseStorageRepository({
      dataSource,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
