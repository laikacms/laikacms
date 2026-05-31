import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { InfluxDbDataSource } from '../influxdb-datasource.js';
import { InfluxDbStorageRepository } from '../influxdb-storage-repository.js';
import { parseLineProtocolPoint, serializeAnnotatedCsv } from '../wire-format.js';

const API = 'https://influx.test:8086';
const ORG = 'cms-org';
const BUCKET = 'cms';
const TOKEN = 'influx_test_token';

interface Row {
  time: string;
  measurement: string;
  kind: 'file' | 'folder';
  parent: string;
  name: string;
  extension: string;
  path: string;
  content: string;
}

const createMockInflux = () => {
  let rows: Row[] = [];

  const finalRows = (): Row[] => {
    const groups = new Map<string, Row>();
    for (const r of rows) {
      const key = `${r.measurement}|${r.kind}|${r.parent}|${r.name}|${r.extension}|${r.path}`;
      const existing = groups.get(key);
      if (!existing || r.time >= existing.time) groups.set(key, r);
    }
    return [...groups.values()];
  };

  const evalFlux = (flux: string): Row[] => {
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

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (!url.startsWith(API)) return new Response('not found', { status: 404 });
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'POST') return new Response('method not allowed', { status: 405 });
    const u = new URL(url);

    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    if (auth !== `Token ${TOKEN}`) return new Response('Unauthorized', { status: 401 });

    const body = (init?.body as string) ?? '';

    if (u.pathname === '/api/v2/write') {
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
      return new Response('', { status: 200 });
    }

    if (u.pathname === '/api/v2/query') {
      if (u.searchParams.get('org') !== ORG) return new Response('wrong org', { status: 400 });
      const matched = evalFlux(body);
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

    if (u.pathname === '/api/v2/delete') {
      if (u.searchParams.get('org') !== ORG) return new Response('wrong org', { status: 400 });
      if (u.searchParams.get('bucket') !== BUCKET) return new Response('wrong bucket', { status: 400 });
      const parsed = JSON.parse(body) as { predicate: string };
      const equalities: Record<string, string> = {};
      for (const match of parsed.predicate.matchAll(/(\w+)\s*=\s*"([^"]+)"/g)) {
        const [, k, v] = match;
        equalities[k!] = v!;
      }
      rows = rows.filter(r => {
        for (const [k, v] of Object.entries(equalities)) {
          const rowVal = k === '_measurement'
            ? r.measurement
            : (r as unknown as Record<string, string>)[k];
          if (rowVal !== v) return true;
        }
        return false;
      });
      return new Response('', { status: 200 });
    }

    return new Response('not found', { status: 404 });
  };

  return { fetch: fetchImpl };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const influxDbContractCase: StorageContractCase = {
  name: 'InfluxDbStorageRepository',
  async makeRepo() {
    const mock = createMockInflux();
    const ds = new InfluxDbDataSource({
      url: API,
      org: ORG,
      bucket: BUCKET,
      auth: { token: TOKEN },
      fetch: mock.fetch,
    });
    return new InfluxDbStorageRepository({
      dataSource: ds,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
