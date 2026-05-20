import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bind, LibSqlDataSource, type LibSqlArg, type LibSqlExecuteResult } from './libsql-datasource.js';
import { LibSqlStorageRepository } from './libsql-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory libSQL hrana mock.
//
// Implements `POST /v2/pipeline` over the SQL subset the repository emits:
//
//   SELECT … FROM table WHERE Type=? AND Parent=? AND Name=? LIMIT 1
//   SELECT 1 FROM table LIMIT 1
//   SELECT 1 FROM table WHERE (Path=? AND Type=?) OR Parent=? LIMIT 1
//   SELECT … FROM table WHERE Parent=?
//   INSERT INTO table (…) VALUES (…)
//   INSERT … ON CONFLICT(Path) DO UPDATE SET Content=excluded.Content, Extension=excluded.Extension
//   INSERT … ON CONFLICT(Path) DO NOTHING
//   UPDATE table SET Content=? WHERE Path=?
//   DELETE FROM table WHERE Path=?
//
// The mock unpacks the typed args, dispatches on a SQL fingerprint, and
// mutates an in-memory map.
// ---------------------------------------------------------------------------

const BASE = 'https://db.test';
const TOKEN = 'libsql_test_token';

interface Row {
  Path: string;
  Parent: string;
  Name: string;
  Type: 'file' | 'folder';
  Extension?: string | null;
  Content?: string | null;
}

let rows: Map<string, Row>;
let pipelineCount = 0;
let executeCount = 0;
let batchCount = 0;
let lastPipelineBody: { requests?: unknown[] } | null = null;
let pipelineBodies: Array<{ requests?: unknown[] }>;

// ---- Arg unpacker --------------------------------------------------------

const unwrapArg = (arg: LibSqlArg): unknown => {
  switch (arg.type) {
    case 'null': return null;
    case 'text': return arg.value;
    case 'integer': return arg.value;
    case 'float': return arg.value;
    case 'blob': return arg.base64;
  }
};

// ---- Statement dispatcher ------------------------------------------------

const COLS = [
  { name: 'Path' }, { name: 'Parent' }, { name: 'Name' },
  { name: 'Type' }, { name: 'Extension' }, { name: 'Content' },
];

const argToText = (arg: LibSqlArg): string | null => {
  if (arg.type === 'null') return null;
  if (arg.type === 'text') return arg.value;
  return String(unwrapArg(arg));
};

const rowToWire = (row: Row): LibSqlArg[] => [
  { type: 'text', value: row.Path },
  { type: 'text', value: row.Parent },
  { type: 'text', value: row.Name },
  { type: 'text', value: row.Type },
  row.Extension ? { type: 'text', value: row.Extension } : { type: 'null' },
  row.Content !== null && row.Content !== undefined ? { type: 'text', value: row.Content } : { type: 'null' },
];

const evalStatement = (sql: string, args: LibSqlArg[]): LibSqlExecuteResult => {
  const s = sql.replace(/\s+/g, ' ').trim();

  // SELECT 1 FROM x LIMIT 1 (root existence)
  if (/^SELECT 1 FROM \w+ LIMIT 1$/i.test(s)) {
    return { cols: [{ name: '1' }], rows: rows.size > 0 ? [[{ type: 'integer', value: '1' }]] : [], affected_row_count: 0 };
  }

  // SELECT 1 FROM x WHERE (Path=? AND Type=?) OR Parent=? LIMIT 1 (folder existence)
  if (/^SELECT 1 FROM \w+ WHERE \(Path = \? AND Type = \?\) OR Parent = \? LIMIT 1$/i.test(s)) {
    const [path, type, parent] = [argToText(args[0]!), argToText(args[1]!), argToText(args[2]!)];
    for (const r of rows.values()) {
      if ((r.Path === path && r.Type === type) || r.Parent === parent) {
        return { cols: [{ name: '1' }], rows: [[{ type: 'integer', value: '1' }]], affected_row_count: 0 };
      }
    }
    return { cols: [{ name: '1' }], rows: [], affected_row_count: 0 };
  }

  // SELECT Path,Parent,Name,Type,Extension,Content FROM x WHERE Type=? AND Parent=? AND Name=? LIMIT 1
  if (/^SELECT Path, Parent, Name, Type, Extension, Content FROM \w+ WHERE Type = \? AND Parent = \? AND Name = \? LIMIT 1$/i.test(s)) {
    const [type, parent, name] = [argToText(args[0]!), argToText(args[1]!), argToText(args[2]!)];
    for (const r of rows.values()) {
      if (r.Type === type && r.Parent === parent && r.Name === name) {
        return { cols: COLS, rows: [rowToWire(r)], affected_row_count: 0 };
      }
    }
    return { cols: COLS, rows: [], affected_row_count: 0 };
  }

  // SELECT … WHERE Parent=?
  if (/^SELECT Path, Parent, Name, Type, Extension, Content FROM \w+ WHERE Parent = \?$/i.test(s)) {
    const parent = argToText(args[0]!);
    const matched = [...rows.values()].filter(r => r.Parent === parent);
    return { cols: COLS, rows: matched.map(rowToWire), affected_row_count: 0 };
  }

  // INSERT INTO x (Path,…) VALUES (?,…)
  if (/^INSERT INTO \w+ \(Path, Parent, Name, Type, Extension, Content\) VALUES \(\?, \?, \?, \?, \?, \?\)$/i.test(s)) {
    const [path, parent, name, type, ext, content] = args.map(argToText);
    if (rows.has(path!)) {
      // Mimic SQLite's UNIQUE constraint failure.
      const err = new Error(`UNIQUE constraint failed: laika_storage.Path: ${path}`);
      throw err;
    }
    rows.set(path!, { Path: path!, Parent: parent!, Name: name!, Type: type as Row['Type'], Extension: ext, Content: content });
    return { cols: [], rows: [], affected_row_count: 1, last_insert_rowid: String(rows.size) };
  }

  // INSERT … ON CONFLICT(Path) DO UPDATE SET Content=excluded.Content, Extension=excluded.Extension
  if (/^INSERT INTO \w+ \(Path, Parent, Name, Type, Extension, Content\) VALUES \(\?, \?, \?, \?, \?, \?\) ON CONFLICT\(Path\) DO UPDATE SET Content = excluded\.Content, Extension = excluded\.Extension$/i.test(s)) {
    const [path, parent, name, type, ext, content] = args.map(argToText);
    rows.set(path!, { Path: path!, Parent: parent!, Name: name!, Type: type as Row['Type'], Extension: ext, Content: content });
    return { cols: [], rows: [], affected_row_count: 1 };
  }

  // INSERT … ON CONFLICT(Path) DO NOTHING  (createFolder)
  if (/^INSERT INTO \w+ \(Path, Parent, Name, Type\) VALUES \(\?, \?, \?, \?\) ON CONFLICT\(Path\) DO NOTHING$/i.test(s)) {
    const [path, parent, name, type] = args.map(argToText);
    if (!rows.has(path!)) {
      rows.set(path!, { Path: path!, Parent: parent!, Name: name!, Type: type as Row['Type'] });
    }
    return { cols: [], rows: [], affected_row_count: 1 };
  }

  // UPDATE x SET Content=? WHERE Path=?
  if (/^UPDATE \w+ SET Content = \? WHERE Path = \?$/i.test(s)) {
    const [content, path] = [argToText(args[0]!), argToText(args[1]!)];
    const r = rows.get(path!);
    if (r) {
      rows.set(path!, { ...r, Content: content });
      return { cols: [], rows: [], affected_row_count: 1 };
    }
    return { cols: [], rows: [], affected_row_count: 0 };
  }

  // DELETE FROM x WHERE Path=?
  if (/^DELETE FROM \w+ WHERE Path = \?$/i.test(s)) {
    const path = argToText(args[0]!);
    const had = rows.delete(path!);
    return { cols: [], rows: [], affected_row_count: had ? 1 : 0 };
  }

  throw new Error(`mock: unrecognised SQL: ${s}`);
};

// ---- Mock fetch ----------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (!url.startsWith(BASE)) return new Response('not found', { status: 404 });
  const path = new URL(url).pathname;
  if (path !== '/v2/pipeline' || (init?.method ?? 'GET').toUpperCase() !== 'POST') {
    return new Response('not found', { status: 404 });
  }
  const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
  if (auth !== `Bearer ${TOKEN}`) return new Response('Unauthorized', { status: 401 });

  pipelineCount += 1;
  const body = JSON.parse(init?.body as string) as {
    requests: Array<
      | { type: 'execute'; stmt: { sql: string; args?: LibSqlArg[] } }
      | { type: 'batch'; batch: { steps: Array<{ stmt: { sql: string; args?: LibSqlArg[] }; condition?: unknown }> } }
    >;
  };
  lastPipelineBody = body;
  pipelineBodies.push(body);

  const results: unknown[] = [];
  for (const req of body.requests) {
    if (req.type === 'execute') {
      executeCount += 1;
      try {
        const result = evalStatement(req.stmt.sql, req.stmt.args ?? []);
        results.push({ type: 'ok', response: { type: 'execute', result } });
      } catch (err) {
        results.push({ type: 'error', error: { message: (err as Error).message } });
      }
    } else if (req.type === 'batch') {
      batchCount += 1;
      const stepResults: Array<LibSqlExecuteResult | null> = [];
      const stepErrors: Array<{ message?: string } | null> = [];
      let aborted = false;
      for (let i = 0; i < req.batch.steps.length; i += 1) {
        const step = req.batch.steps[i]!;
        // Skip if any prior step failed — the default `condition: ok(prev)`
        // semantics. (The mock's check is a simplification; real libSQL
        // evaluates the explicit `condition` expression.)
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

// ---------------------------------------------------------------------------
// Minimal test serializer registry.
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) =>
      String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (): LibSqlStorageRepository => {
  const ds = new LibSqlDataSource({ url: BASE, auth: { token: TOKEN }, fetch: mockFetch });
  return new LibSqlStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  rows = new Map();
  pipelineCount = 0;
  executeCount = 0;
  batchCount = 0;
  lastPipelineBody = null;
  pipelineBodies = [];
});

afterEach(() => {
  rows.clear();
});

describe('bind helper', () => {
  it('converts JS values to libSQL typed args', () => {
    expect(bind(null)).toEqual({ type: 'null' });
    expect(bind('hello')).toEqual({ type: 'text', value: 'hello' });
    expect(bind(42)).toEqual({ type: 'integer', value: '42' });
    expect(bind(3.14)).toEqual({ type: 'float', value: 3.14 });
    expect(bind(true)).toEqual({ type: 'integer', value: '1' });
    expect(bind(false)).toEqual({ type: 'integer', value: '0' });
  });
});

describe('LibSqlStorageRepository', () => {
  it('createObject + getObject round-trip stores a row with Type/Parent/Name/Extension', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');

    const stored = rows.get('notes/hello.md');
    expect(stored).toMatchObject({
      Type: 'file',
      Parent: 'notes',
      Name: 'hello',
      Extension: 'md',
      Content: 'hi',
    });

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('createObject rejects duplicates via UNIQUE constraint → EntryAlreadyExistsError', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('removeAtoms ships as ONE batch request with N conditional DELETE steps', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    batchCount = 0;
    executeCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // *The* distinctive trait — exactly one `batch` request, never
    // multiple `execute` calls. The N resolve `execute`s come earlier
    // (one per key, in separate pipelines for now), but the deletion
    // itself is a single atomic batch.
    expect(batchCount).toBe(1);
    expect(rows.size).toBe(0);

    // Inspect the actual batch shape: N steps, each conditioned on the prior.
    const batchReq = (lastPipelineBody!.requests as Array<{ type: string; batch?: { steps: Array<{ condition?: unknown }> } }>)
      .find(r => r.type === 'batch');
    expect(batchReq).toBeDefined();
    const steps = batchReq!.batch!.steps;
    expect(steps).toHaveLength(3);
    expect(steps[0]!.condition).toBeUndefined();
    expect(steps[1]!.condition).toEqual({ type: 'ok', step: 0 });
    expect(steps[2]!.condition).toEqual({ type: 'ok', step: 1 });
  });

  it('removeAtoms reports missing keys as skipped', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/nope']),
    );
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors.length).toBe(1);
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('arguments cross the wire as typed objects, not bare positional values', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // Find the INSERT request across all pipeline bodies — every arg is a typed object.
    const allRequests = pipelineBodies.flatMap(b =>
      (b.requests ?? []) as Array<{ type: string; stmt?: { sql: string; args?: LibSqlArg[] } }>,
    );
    const inserts = allRequests.filter(r => r.type === 'execute' && r.stmt?.sql?.startsWith('INSERT'));
    expect(inserts.length).toBeGreaterThan(0);
    for (const ins of inserts) {
      for (const arg of ins.stmt!.args!) {
        expect(arg).toHaveProperty('type');
        // {type: 'text', value: ...} or {type: 'null'} — not a bare string.
      }
    }
  });

  it('createOrUpdateObject uses ON CONFLICT DO UPDATE — single statement, idempotent', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createOrUpdateObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      repo.createOrUpdateObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
    );
    expect(rows.get('notes/x.md')?.Content).toBe('b');
  });

  it('listAtomSummaries returns child files and folders for a parent', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes/sub' }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('notes', { pagination: PAGE }),
    );
    const types = collected.data.reduce((acc, s) => {
      acc[s.key] = s.type;
      return acc;
    }, {} as Record<string, string>);
    expect(types).toEqual({
      'notes/a': 'object-summary',
      'notes/b': 'object-summary',
      'notes/sub': 'folder-summary',
    });
  });

  it('listAtomSummaries orders results naturally', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '10', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '2', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '1', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: PAGE }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10']);
  });

  it('createFolder creates a folder row idempotently (ON CONFLICT DO NOTHING)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    expect(rows.get('empty')).toMatchObject({ Type: 'folder', Parent: '', Name: 'empty' });

    const folder = await LaikaTask.runPromise(repo.getFolder('empty'));
    expect(folder.type).toBe('folder');
  });

  it('getFolder also recognises a folder via descendants (implicit)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'x' } }),
    );
    const folder = await LaikaTask.runPromise(repo.getFolder('notes'));
    expect(folder.type).toBe('folder');
  });

  it('getFolder fails for a missing path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found/i);
  });

  it('tableName option is validated against an injection-safe regex', async () => {
    const ds = new LibSqlDataSource({ url: BASE, auth: { token: TOKEN }, fetch: mockFetch });
    expect(() => new LibSqlStorageRepository({
      dataSource: ds,
      tableName: "evil; DROP TABLE laika_storage --",
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'md',
    })).toThrow(/Invalid SQL identifier/);
  });
});

// Acknowledge unused counters so unused-var lints don't trip.
void pipelineCount;
void executeCount;
