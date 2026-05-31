import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { type LibSqlArg, LibSqlDataSource, type LibSqlExecuteResult } from '../libsql-datasource.js';
import { LibSqlStorageRepository } from '../libsql-storage-repository.js';

const BASE = 'https://db.libsql-contract-test.internal';
const TOKEN = 'libsql_contract_token';

interface Row {
  Path: string;
  Parent: string;
  Name: string;
  Type: 'file' | 'folder';
  Extension?: string | null;
  Content?: string | null;
}

const COLS = [
  { name: 'Path' },
  { name: 'Parent' },
  { name: 'Name' },
  { name: 'Type' },
  { name: 'Extension' },
  { name: 'Content' },
];

const argToText = (arg: LibSqlArg): string | null => {
  if (arg.type === 'null') return null;
  if (arg.type === 'text') return arg.value;
  if (arg.type === 'integer') return arg.value;
  if (arg.type === 'float') return String(arg.value);
  return null;
};

const rowToWire = (row: Row): LibSqlArg[] => [
  { type: 'text', value: row.Path },
  { type: 'text', value: row.Parent },
  { type: 'text', value: row.Name },
  { type: 'text', value: row.Type },
  row.Extension ? { type: 'text', value: row.Extension } : { type: 'null' },
  row.Content !== null && row.Content !== undefined ? { type: 'text', value: row.Content } : { type: 'null' },
];

const createMockLibSql = () => {
  const rows = new Map<string, Row>();

  const evalStatement = (sql: string, args: LibSqlArg[]): LibSqlExecuteResult => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/^SELECT 1 FROM \w+ LIMIT 1$/i.test(s)) {
      return {
        cols: [{ name: '1' }],
        rows: rows.size > 0 ? [[{ type: 'integer', value: '1' }]] : [],
        affected_row_count: 0,
      };
    }

    if (/^SELECT 1 FROM \w+ WHERE \(Path = \? AND Type = \?\) OR Parent = \? LIMIT 1$/i.test(s)) {
      const [path, type, parent] = [argToText(args[0]!), argToText(args[1]!), argToText(args[2]!)];
      for (const r of rows.values()) {
        if ((r.Path === path && r.Type === type) || r.Parent === parent) {
          return { cols: [{ name: '1' }], rows: [[{ type: 'integer', value: '1' }]], affected_row_count: 0 };
        }
      }
      return { cols: [{ name: '1' }], rows: [], affected_row_count: 0 };
    }

    if (
      /^SELECT Path, Parent, Name, Type, Extension, Content FROM \w+ WHERE Type = \? AND Parent = \? AND Name = \? LIMIT 1$/i
        .test(s)
    ) {
      const [type, parent, name] = [argToText(args[0]!), argToText(args[1]!), argToText(args[2]!)];
      for (const r of rows.values()) {
        if (r.Type === type && r.Parent === parent && r.Name === name) {
          return { cols: COLS, rows: [rowToWire(r)], affected_row_count: 0 };
        }
      }
      return { cols: COLS, rows: [], affected_row_count: 0 };
    }

    if (/^SELECT Path, Parent, Name, Type, Extension, Content FROM \w+ WHERE Parent = \?$/i.test(s)) {
      const parent = argToText(args[0]!);
      const matched = [...rows.values()].filter(r => r.Parent === parent);
      return { cols: COLS, rows: matched.map(rowToWire), affected_row_count: 0 };
    }

    if (
      /^INSERT INTO \w+ \(Path, Parent, Name, Type, Extension, Content\) VALUES \(\?, \?, \?, \?, \?, \?\)$/i.test(s)
    ) {
      const [path, parent, name, type, ext, content] = args.map(argToText);
      if (rows.has(path!)) {
        throw new Error(`UNIQUE constraint failed: laika_storage.Path: ${path}`);
      }
      rows.set(path!, {
        Path: path!,
        Parent: parent!,
        Name: name!,
        Type: type as Row['Type'],
        Extension: ext,
        Content: content,
      });
      return { cols: [], rows: [], affected_row_count: 1, last_insert_rowid: String(rows.size) };
    }

    if (
      /^INSERT INTO \w+ \(Path, Parent, Name, Type, Extension, Content\) VALUES \(\?, \?, \?, \?, \?, \?\) ON CONFLICT\(Path\) DO UPDATE SET Content = excluded\.Content, Extension = excluded\.Extension$/i
        .test(s)
    ) {
      const [path, parent, name, type, ext, content] = args.map(argToText);
      rows.set(path!, {
        Path: path!,
        Parent: parent!,
        Name: name!,
        Type: type as Row['Type'],
        Extension: ext,
        Content: content,
      });
      return { cols: [], rows: [], affected_row_count: 1 };
    }

    if (
      /^INSERT INTO \w+ \(Path, Parent, Name, Type\) VALUES \(\?, \?, \?, \?\) ON CONFLICT\(Path\) DO NOTHING$/i.test(s)
    ) {
      const [path, parent, name, type] = args.map(argToText);
      if (!rows.has(path!)) {
        rows.set(path!, { Path: path!, Parent: parent!, Name: name!, Type: type as Row['Type'] });
      }
      return { cols: [], rows: [], affected_row_count: 1 };
    }

    if (/^UPDATE \w+ SET Content = \? WHERE Path = \?$/i.test(s)) {
      const [content, path] = [argToText(args[0]!), argToText(args[1]!)];
      const r = rows.get(path!);
      if (r) {
        rows.set(path!, { ...r, Content: content });
        return { cols: [], rows: [], affected_row_count: 1 };
      }
      return { cols: [], rows: [], affected_row_count: 0 };
    }

    if (/^DELETE FROM \w+ WHERE Path = \?$/i.test(s)) {
      const path = argToText(args[0]!);
      const had = rows.delete(path!);
      return { cols: [], rows: [], affected_row_count: had ? 1 : 0 };
    }

    throw new Error(`mock: unrecognised SQL: ${s}`);
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (!url.startsWith(BASE)) return new Response('not found', { status: 404 });
    const path = new URL(url).pathname;
    if (path !== '/v2/pipeline' || (init?.method ?? 'GET').toUpperCase() !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    if (auth !== `Bearer ${TOKEN}`) return new Response('Unauthorized', { status: 401 });

    const body = JSON.parse(init?.body as string) as {
      requests: Array<
        | { type: 'execute', stmt: { sql: string, args?: LibSqlArg[] } }
        | { type: 'batch', batch: { steps: Array<{ stmt: { sql: string, args?: LibSqlArg[] }, condition?: unknown }> } }
      >,
    };

    const results: unknown[] = [];
    for (const req of body.requests) {
      if (req.type === 'execute') {
        try {
          const result = evalStatement(req.stmt.sql, req.stmt.args ?? []);
          results.push({ type: 'ok', response: { type: 'execute', result } });
        } catch (err) {
          results.push({ type: 'error', error: { message: (err as Error).message } });
        }
      } else if (req.type === 'batch') {
        const stepResults: Array<LibSqlExecuteResult | null> = [];
        const stepErrors: Array<{ message?: string } | null> = [];
        let aborted = false;
        for (const step of req.batch.steps) {
          if (aborted) {
            stepResults.push(null);
            stepErrors.push(null);
            continue;
          }
          try {
            const r = evalStatement(step.stmt.sql, step.stmt.args ?? []);
            stepResults.push(r);
            stepErrors.push(null);
          } catch (err) {
            stepResults.push(null);
            stepErrors.push({ message: (err as Error).message });
            aborted = true;
          }
        }
        results.push({
          type: 'ok',
          response: { type: 'batch', result: { step_results: stepResults, step_errors: stepErrors } },
        });
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
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

export const libSqlContractCase: StorageContractCase = {
  name: 'LibSqlStorageRepository',
  async makeRepo() {
    const backend = createMockLibSql();
    const ds = new LibSqlDataSource({ url: BASE, auth: { token: TOKEN }, fetch: backend.fetch });
    return new LibSqlStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
