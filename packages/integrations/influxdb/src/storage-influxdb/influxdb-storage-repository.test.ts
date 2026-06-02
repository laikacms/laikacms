import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InfluxDbDataSource } from './influxdb-datasource.js';
import { InfluxDbStorageRepository } from './influxdb-storage-repository.js';
import { influxDbContractCase } from './testing/index.js';
import {
  parseAnnotatedCsv,
  parseLineProtocolPoint,
  serializeAnnotatedCsv,
  serializeLineProtocolPoint,
} from './wire-format.js';

runStorageRepositoryContract(influxDbContractCase);

// ---------------------------------------------------------------------------
// In-memory InfluxDB v2 HTTP mock.
//
// Three endpoints with three different content types:
//
//   POST /api/v2/write   (text/plain body — line protocol)
//   POST /api/v2/query   (application/vnd.flux body — Flux source)
//   POST /api/v2/delete  (application/json body — predicate object)
//
// The Flux dispatcher matches the specific pipeline shapes the
// repository emits and returns serialized annotated CSV.
// ---------------------------------------------------------------------------

const API = 'https://influx.test:8086';
const ORG = 'cms-org';
const BUCKET = 'cms';
const TOKEN = 'influx_test_token';

interface Row {
  time: string; // ISO timestamp
  measurement: string;
  kind: 'file' | 'folder';
  parent: string;
  name: string;
  extension: string;
  path: string;
  content: string;
}

let rows: Row[]; // every write appends; reads filter by `|> last()`
let writeCount: number;
let queryCount: number;
let deleteCount: number;
let lastFlux: string | null = null;

const finalRows = (): Row[] => {
  // Apply `|> last()` semantics — keep only the latest row per
  // (measurement, kind, parent, name, extension, path) tag-set.
  const groups = new Map<string, Row>();
  for (const r of rows) {
    const key = `${r.measurement}|${r.kind}|${r.parent}|${r.name}|${r.extension}|${r.path}`;
    const existing = groups.get(key);
    if (!existing || r.time > existing.time) groups.set(key, r);
  }
  return [...groups.values()];
};

// ---- Auth header check ---------------------------------------------------

const expectedAuth = `Token ${TOKEN}`;

// ---- Flux dispatcher -----------------------------------------------------

const evalFlux = (flux: string): Row[] => {
  // Extract every `r.<key> == "<value>"` clause.
  const predicates: Record<string, string> = {};
  for (const match of flux.matchAll(/r\.(\w+)\s*==\s*"([^"]+)"/g)) {
    const [, k, v] = match;
    predicates[k!] = v!;
  }
  return finalRows().filter(r => {
    if (predicates['_measurement'] !== undefined && r.measurement !== predicates['_measurement']) return false;
    if (predicates['kind'] !== undefined && r.kind !== predicates['kind']) return false;
    if (predicates['parent'] !== undefined && r.parent !== predicates['parent']) return false;
    if (predicates['name'] !== undefined && r.name !== predicates['name']) return false;
    if (predicates['path'] !== undefined && r.path !== predicates['path']) return false;
    if (predicates['extension'] !== undefined && r.extension !== predicates['extension']) return false;
    return true;
  });
};

// ---- Mock fetch ----------------------------------------------------------

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as URL).toString();
  if (!url.startsWith(API)) return new Response('not found', { status: 404 });
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'POST') return new Response('method not allowed', { status: 405 });
  const u = new URL(url);

  const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
  if (auth !== expectedAuth) return new Response('Unauthorized', { status: 401 });

  const body = (init?.body as string) ?? '';

  // ---- WRITE -------------------------------------------------------------
  if (u.pathname === '/api/v2/write') {
    writeCount += 1;
    if (u.searchParams.get('org') !== ORG) return new Response('wrong org', { status: 400 });
    if (u.searchParams.get('bucket') !== BUCKET) return new Response('wrong bucket', { status: 400 });
    for (const line of body.split('\n').filter(l => l.length > 0)) {
      const point = parseLineProtocolPoint(line);
      const ns = BigInt(point.timestampNs);
      const ms = Number(ns / BigInt(1_000_000));
      rows.push({
        time: new Date(ms).toISOString(),
        measurement: point.measurement,
        kind: (point.tags['kind'] as 'file' | 'folder') ?? 'file',
        parent: point.tags['parent'] ?? '',
        name: point.tags['name'] ?? '',
        extension: point.tags['extension'] ?? '',
        path: point.tags['path'] ?? '',
        content: String(point.fields['content'] ?? ''),
      });
    }
    // Note: undici's Response constructor rejects 204; using 200 with empty
    // body — the data source only checks `response.ok` (200-299).
    return new Response('', { status: 200 });
  }

  // ---- QUERY -------------------------------------------------------------
  if (u.pathname === '/api/v2/query') {
    queryCount += 1;
    if (u.searchParams.get('org') !== ORG) return new Response('wrong org', { status: 400 });
    lastFlux = body;
    const matched = evalFlux(body);
    // After `|> last()` and `|> pivot(...)`, the response has one row per
    // record with column = `_time`, `kind`, `parent`, `name`, `extension`,
    // `path`, `content`. Synthesize that CSV.
    const columns = [
      { name: '_time', datatype: 'dateTime:RFC3339' },
      { name: 'kind', datatype: 'string' },
      { name: 'parent', datatype: 'string' },
      { name: 'name', datatype: 'string' },
      { name: 'extension', datatype: 'string' },
      { name: 'path', datatype: 'string' },
      { name: 'content', datatype: 'string' },
    ];
    const csvRows = matched.map(r => ({
      _time: r.time,
      kind: r.kind,
      parent: r.parent,
      name: r.name,
      extension: r.extension,
      path: r.path,
      content: r.content,
    }));
    return new Response(serializeAnnotatedCsv(columns, csvRows), {
      status: 200,
      headers: { 'content-type': 'application/csv' },
    });
  }

  // ---- DELETE ------------------------------------------------------------
  if (u.pathname === '/api/v2/delete') {
    deleteCount += 1;
    if (u.searchParams.get('org') !== ORG) return new Response('wrong org', { status: 400 });
    if (u.searchParams.get('bucket') !== BUCKET) return new Response('wrong bucket', { status: 400 });
    const parsed = JSON.parse(body) as { predicate: string };
    // Parse `_measurement="X" AND tag="Y"` predicates.
    const equalities: Record<string, string> = {};
    for (const match of parsed.predicate.matchAll(/(\w+)\s*=\s*"([^"]+)"/g)) {
      const [, k, v] = match;
      equalities[k!] = v!;
    }
    // Remove every row matching ALL equalities.
    rows = rows.filter(r => {
      for (const [k, v] of Object.entries(equalities)) {
        const rowVal = k === '_measurement'
          ? r.measurement
          : (r as unknown as Record<string, string>)[k];
        if (rowVal !== v) return true;
      }
      return false;
    });
    // Note: undici's Response constructor rejects 204; using 200 with empty
    // body — the data source only checks `response.ok` (200-299).
    return new Response('', { status: 200 });
  }

  return new Response('not found', { status: 404 });
};

// ---------------------------------------------------------------------------
// Serializer registry
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) => String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (fetchImpl: typeof fetch = mockFetch): InfluxDbStorageRepository => {
  const ds = new InfluxDbDataSource({
    url: API,
    org: ORG,
    bucket: BUCKET,
    auth: { token: TOKEN },
    fetch: fetchImpl,
  });
  return new InfluxDbStorageRepository({
    dataSource: ds,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  rows = [];
  writeCount = 0;
  queryCount = 0;
  deleteCount = 0;
  lastFlux = null;
});

afterEach(() => {
  rows.length = 0;
});

// ---------------------------------------------------------------------------
// Wire-format unit tests
// ---------------------------------------------------------------------------

describe('line protocol', () => {
  it('serializes a point with escaped tag values', () => {
    const line = serializeLineProtocolPoint({
      measurement: 'laika_storage',
      tags: { parent: 'has spaces, commas=fun', name: 'hello' },
      fields: { content: 'hi "quoted" \\backslash' },
      timestampNs: '1700000000000000000',
    });
    // Tag values get `,`, ` `, `=` escaped.
    expect(line).toContain('parent=has\\ spaces\\,\\ commas\\=fun');
    expect(line).toContain('name=hello');
    // Field string values get `"` and `\` escaped.
    expect(line).toContain('content="hi \\"quoted\\" \\\\backslash"');
    expect(line.endsWith(' 1700000000000000000')).toBe(true);
  });

  it('round-trips through parse', () => {
    const original = {
      measurement: 'laika_storage',
      tags: { kind: 'file', parent: 'notes', name: 'hello' },
      fields: { content: 'hi' },
      timestampNs: '1700000000000000000',
    };
    const line = serializeLineProtocolPoint(original);
    const parsed = parseLineProtocolPoint(line);
    expect(parsed.measurement).toBe('laika_storage');
    expect(parsed.tags).toEqual(original.tags);
    expect(parsed.fields).toEqual({ content: 'hi' });
    expect(parsed.timestampNs).toBe('1700000000000000000');
  });
});

describe('annotated CSV', () => {
  it('parses the annotated format (skipping #datatype/#group/#default rows)', () => {
    const csv = serializeAnnotatedCsv(
      [
        { name: '_time', datatype: 'dateTime:RFC3339' },
        { name: 'parent', datatype: 'string' },
      ],
      [{ _time: '2026-05-20T10:00:00Z', parent: 'notes' }],
    );
    const parsed = parseAnnotatedCsv(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ _time: '2026-05-20T10:00:00Z', parent: 'notes' });
  });

  it('handles CRLF and trailing newlines', () => {
    // Three annotation rows + header row + two data rows. The empty leading
    // column is the conventional "result" header column we skip.
    const csv =
      `#datatype,string,string\r\n#group,false,false\r\n#default,_result,\r\n,result,name\r\n,_result,foo\r\n,_result,bar\r\n`;
    const parsed = parseAnnotatedCsv(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ name: 'foo' });
    expect(parsed[1]).toEqual({ name: 'bar' });
  });
});

// ---------------------------------------------------------------------------
// Repository tests
// ---------------------------------------------------------------------------

describe('InfluxDbStorageRepository', () => {
  it('createObject + getObject round-trip writes a point via line protocol', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // `_time` IS the revisionId — nanosecond-precision timestamp.
    expect(created.metadata?.revisionId).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The point was written with the right tag/field shape.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      measurement: 'laika_storage',
      kind: 'file',
      parent: 'notes',
      name: 'hello',
      extension: 'md',
      path: 'notes/hello.md',
      content: 'hi',
    });

    // Round-trip.
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('write request uses `Authorization: Token <token>` header (NOT Bearer)', async () => {
    let lastAuth: string | null = null;
    const sniff: typeof fetch = async (input, init) => {
      lastAuth = (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? null;
      return mockFetch(input, init);
    };
    const repo = makeRepo(sniff);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    // *The* distinctive auth-header quirk.
    expect(lastAuth).toBe(`Token ${TOKEN}`);
    expect(lastAuth).not.toContain('Bearer');
  });

  it('write body is line protocol — newline-delimited points with tag=value field=value timestamp', async () => {
    let lastWriteBody: string | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('/api/v2/write')) lastWriteBody = init?.body as string;
      return mockFetch(input, init);
    };
    const repo = makeRepo(sniff);
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    expect(lastWriteBody).toBeTruthy();
    // Line protocol shape: `measurement,tag=v,tag=v field=v timestamp`.
    expect(lastWriteBody).toMatch(/^laika_storage,/);
    expect(lastWriteBody).toContain('kind=file');
    expect(lastWriteBody).toContain('content="a"');
    // Nanosecond timestamp suffix (19 digits).
    expect(lastWriteBody).toMatch(/ \d{19}$/);
  });

  it('reads use Flux pipeline DSL with |> last() and pivot', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    lastFlux = null;
    await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(lastFlux).toContain('from(bucket: "cms")');
    expect(lastFlux).toContain('|> range(start: 0)');
    expect(lastFlux).toContain('|> filter(fn: (r) =>');
    expect(lastFlux).toContain('|> last()');
    expect(lastFlux).toContain('|> pivot(rowKey:');
  });

  it('updateObject re-writes the point — `|> last()` reads return the new value', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await new Promise(r => setTimeout(r, 2)); // ensure timestamp advances
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    // Two physical rows in storage now.
    expect(rows).toHaveLength(2);
    // Reads see only the latest via |> last().
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(fetched.content).toEqual({ body: 'b' });
  });

  it('createObject rejects duplicates via application-level probe', async () => {
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

  it('removeAtoms does N parallel /api/v2/delete calls', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    deleteCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // Honest: 3 separate DELETE calls — Influx v2 has no bulk-OR
    // predicate that works reliably.
    expect(deleteCount).toBe(3);
    // After delete, no `kind=file` rows remain.
    expect(finalRows().filter(r => r.kind === 'file')).toHaveLength(0);
  });

  it('delete body is `_measurement="X" AND path="Y"` predicate JSON', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    let lastDeleteBody: string | null = null;
    const sniff: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('/api/v2/delete')) lastDeleteBody = init?.body as string;
      return mockFetch(input, init);
    };
    const sniffRepo = new InfluxDbStorageRepository({
      dataSource: new InfluxDbDataSource({
        url: API,
        org: ORG,
        bucket: BUCKET,
        auth: { token: TOKEN },
        fetch: sniff,
      }),
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'md',
    });
    await LaikaStream.runPromiseCollect(sniffRepo.removeAtoms(['notes/x']));
    expect(lastDeleteBody).toBeTruthy();
    const body = JSON.parse(lastDeleteBody!);
    expect(body.predicate).toContain('_measurement="laika_storage"');
    expect(body.predicate).toContain('path="notes/x.md"');
    // Time bounds are full-range by default.
    expect(body.start).toBeTruthy();
    expect(body.stop).toBeTruthy();
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
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries dispatches a Flux query with filter(r.parent == "X")', async () => {
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

  it('createFolder writes a kind=folder point', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'folder', name: 'empty', path: 'empty' });
  });

  it('getFolder fails for a missing folder path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found|empty/i);
  });

  it('measurement-name validation rejects injection patterns', async () => {
    const ds = new InfluxDbDataSource({
      url: API,
      org: ORG,
      bucket: BUCKET,
      auth: { token: TOKEN },
      fetch: mockFetch,
    });
    expect(() =>
      new InfluxDbStorageRepository({
        dataSource: ds,
        measurement: 'evil; DROP measurement laika_storage',
        serializerRegistry: serializerRegistry as never,
        defaultFileExtension: 'md',
      })
    ).toThrow(/Invalid Flux\/measurement identifier/);
  });
});

// Reference unused symbols.
void writeCount;
void queryCount;
