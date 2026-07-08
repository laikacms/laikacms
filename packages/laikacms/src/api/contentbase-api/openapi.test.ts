import { describe, expect, it } from 'vitest';

import type { ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import type { OpenApiDocument, OpenApiOperation, OpenApiPathItem } from 'laikacms/json-api';

import { buildContentbaseOpenApi } from './openapi.js';
import { buildJsonApi } from './server.js';

// Minimal stub repo — /openapi.json hits no repo methods.
const stubRepo = {} as ContentBaseSettingsProvider;

const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

function operationsOf(pathItem: OpenApiPathItem): OpenApiOperation[] {
  return HTTP_METHODS.flatMap(method => pathItem[method] ? [pathItem[method]] : []);
}

// ---------------------------------------------------------------------------
// GET /openapi.json — served document
// ---------------------------------------------------------------------------

describe('GET /openapi.json', () => {
  it('returns 200 with application/json', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('serves an OpenAPI 3.1.0 document', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Laika CMS Contentbase API');
    expect(doc.info.version).toBe('1.0.1');
  });

  it('rewrites servers[0].url to the request origin', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('https://cms.example.com/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com');
  });

  it('reflects a custom basePath in servers[0].url', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/contentbase' });
    const res = await api.fetch(new Request('https://cms.example.com/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com/api/contentbase');
  });
});

// ---------------------------------------------------------------------------
// buildContentbaseOpenApi — document structure
// ---------------------------------------------------------------------------

describe('buildContentbaseOpenApi', () => {
  it('lists exactly the implemented routes as paths', () => {
    const doc = buildContentbaseOpenApi();
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/collections',
      '/collections/{key}',
      '/openapi.json',
    ]);
  });

  it('documents exactly the implemented methods per path', () => {
    const doc = buildContentbaseOpenApi();
    const methodsOf = (path: string) => HTTP_METHODS.filter(method => doc.paths[path]?.[method]).sort();
    expect(methodsOf('/openapi.json')).toEqual(['get']);
    expect(methodsOf('/collections')).toEqual(['get', 'post']);
    expect(methodsOf('/collections/{key}')).toEqual(['delete', 'get', 'patch']);
  });

  it('gives every operation an operationId and responses', () => {
    const doc = buildContentbaseOpenApi();
    const operations = Object.values(doc.paths).flatMap(operationsOf);
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation.operationId).toBeTruthy();
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
    }
  });

  it('defaults servers[0].url to /', () => {
    const doc = buildContentbaseOpenApi();
    expect(doc.servers?.[0]?.url).toBe('/');
  });

  it('reflects a custom basePath in servers while keeping paths relative', () => {
    const doc = buildContentbaseOpenApi({ basePath: '/api/contentbase' });
    expect(doc.servers?.[0]?.url).toBe('/api/contentbase');
    for (const path of Object.keys(doc.paths)) {
      expect(path.startsWith('/api/contentbase')).toBe(false);
    }
  });

  it('resolves every $ref to a declared component schema', () => {
    const doc = buildContentbaseOpenApi();
    const schemas = doc.components?.schemas ?? {};
    const refs = JSON.stringify(doc).match(/"#\/components\/schemas\/[^"]+"/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = ref.slice('"#/components/schemas/'.length, -1);
      expect(schemas[name], `missing component schema '${name}'`).toBeDefined();
    }
  });
});
