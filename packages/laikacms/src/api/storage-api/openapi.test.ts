import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import type { OpenApiDocument, OpenApiOperation, OpenApiPathItem } from 'laikacms/json-api';
import type { StorageRepository } from 'laikacms/storage';

import { buildStorageOpenApi } from './openapi.js';
import { buildJsonApi } from './server.js';

// The openapi.json route never touches the repo, so a placeholder cast is enough.
const stubRepo = {} as StorageRepository;

const EXPECTED_PATHS = [
  '/',
  '/atom-summaries',
  '/atom-summaries/{key}',
  '/atoms',
  '/atoms/{key}',
  '/capabilities',
  '/folders/{key}',
  '/objects',
  '/objects/{key}',
  '/openapi.json',
  '/openapi.yaml',
  '/operations',
];

const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

const operationsOf = (item: OpenApiPathItem): OpenApiOperation[] =>
  HTTP_METHODS.map(method => item[method]).filter((op): op is OpenApiOperation => op !== undefined);

describe('GET /openapi.json', () => {
  it('returns 200 with an application/json OpenAPI 3.1 document', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');

    const doc = await res.json() as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Laika CMS Storage API');
  });

  it('rewrites servers[0].url to the request origin + basePath', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('https://storage.example.com/openapi.json'));
    expect(res.status).toBe(200);

    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://storage.example.com');
  });

  it('reflects a custom basePath in the served document', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/storage' });
    const res = await api.fetch(new Request('http://localhost/api/storage/openapi.json'));
    expect(res.status).toBe(200);

    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('http://localhost/api/storage');
  });
});

describe('GET /openapi.yaml', () => {
  it('returns 200 with an application/yaml OpenAPI 3.1 document', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/openapi.yaml'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/yaml');

    const doc = load(await res.text()) as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Laika CMS Storage API');
  });

  it('rewrites servers[0].url to the request origin + basePath', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/storage' });
    const res = await api.fetch(new Request('https://storage.example.com/api/storage/openapi.yaml'));
    expect(res.status).toBe(200);

    const doc = load(await res.text()) as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://storage.example.com/api/storage');
  });
});

describe('buildStorageOpenApi', () => {
  it('documents exactly the implemented routes', () => {
    const doc = buildStorageOpenApi();
    expect(Object.keys(doc.paths).sort()).toEqual(EXPECTED_PATHS);
  });

  it('gives every operation an operationId, summary, tags, and responses', () => {
    const doc = buildStorageOpenApi();
    const operations = Object.values(doc.paths).flatMap(operationsOf);
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation.operationId).toBeDefined();
      expect(operation.summary).toBeDefined();
      expect(operation.tags?.length).toBeGreaterThan(0);
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
    }
  });

  it('assigns a unique operationId to every operation', () => {
    const doc = buildStorageOpenApi();
    const ids = Object.values(doc.paths).flatMap(operationsOf).map(op => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents every {key} path with a required path parameter', () => {
    const doc = buildStorageOpenApi();
    for (const [path, item] of Object.entries(doc.paths)) {
      if (!path.includes('{key}')) continue;
      const keyParam = item.parameters?.find(p => p.name === 'key' && p.in === 'path');
      expect(keyParam, `missing key path parameter on ${path}`).toBeDefined();
      expect(keyParam?.required).toBe(true);
    }
  });

  it('uses the basePath as the static server url', () => {
    expect(buildStorageOpenApi({ basePath: '/api/storage' }).servers?.[0]?.url).toBe('/api/storage');
    expect(buildStorageOpenApi().servers?.[0]?.url).toBe('/');
  });

  it('POST /objects declares an explicit 409 for duplicate-key conflict (LCMS-287)', () => {
    const doc = buildStorageOpenApi();
    const paths = doc.paths as Record<string, { post?: { responses: Record<string, unknown> } }>;
    expect(Object.keys(paths['/objects']!.post!.responses)).toContain('409');
  });
});
