import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import type { CatalogProvider } from 'laikacms/catalog';
import type { OpenApiDocument, OpenApiOperation, OpenApiPathItem } from 'laikacms/json-api';

import { buildCatalogOpenApi } from './openapi.js';
import { buildJsonApi } from './server.js';

// Minimal stub repo — /openapi.json hits no repo methods.
const stubRepo = {} as CatalogProvider;

const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

function operationsOf(pathItem: OpenApiPathItem): OpenApiOperation[] {
  return HTTP_METHODS.flatMap(method => pathItem[method] ? [pathItem[method]] : []);
}

// ---------------------------------------------------------------------------
// GET /openapi.json — served document
// ---------------------------------------------------------------------------

describe('GET /openapi.json', () => {
  it('returns 200 with application/json', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('serves an OpenAPI 3.1.0 document', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Laika CMS Catalog API');
    expect(doc.info.version).toBe('1.0.1');
  });

  it('rewrites servers[0].url to the request origin', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com');
  });

  it('reflects a custom basePath in servers[0].url', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/catalog', authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/api/catalog/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com/api/catalog');
  });

  it('serves openapi.json under a non-root basePath (not at the root path)', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/catalog', authorize: allowAll });
    const mounted = await api.fetch(new Request('https://cms.example.com/api/catalog/openapi.json'));
    expect(mounted.status).toBe(200);
    const root = await api.fetch(new Request('https://cms.example.com/openapi.json'));
    expect(root.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /openapi.yaml — served document
// ---------------------------------------------------------------------------

describe('GET /openapi.yaml', () => {
  it('returns 200 with application/yaml', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.yaml'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/yaml');
  });

  it('serves the same OpenAPI document as YAML with servers[0].url rewritten', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/openapi.yaml'));
    const doc = load(await res.text()) as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Laika CMS Catalog API');
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com');
  });
});

// ---------------------------------------------------------------------------
// buildCatalogOpenApi — document structure
// ---------------------------------------------------------------------------

describe('buildCatalogOpenApi', () => {
  it('lists exactly the implemented routes as paths', () => {
    const doc = buildCatalogOpenApi();
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/collections',
      '/collections/{key}',
      '/openapi.json',
      '/openapi.yaml',
    ]);
  });

  it('documents exactly the implemented methods per path', () => {
    const doc = buildCatalogOpenApi();
    const methodsOf = (path: string) => HTTP_METHODS.filter(method => doc.paths[path]?.[method]).sort();
    expect(methodsOf('/openapi.json')).toEqual(['get']);
    expect(methodsOf('/collections')).toEqual(['get', 'post']);
    expect(methodsOf('/collections/{key}')).toEqual(['delete', 'get', 'patch']);
  });

  it('gives every operation an operationId and responses', () => {
    const doc = buildCatalogOpenApi();
    const operations = Object.values(doc.paths).flatMap(operationsOf);
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation.operationId).toBeTruthy();
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
    }
  });

  it('defaults servers[0].url to /', () => {
    const doc = buildCatalogOpenApi();
    expect(doc.servers?.[0]?.url).toBe('/');
  });

  it('reflects a custom basePath in servers while keeping paths relative', () => {
    const doc = buildCatalogOpenApi({ basePath: '/api/catalog', authorize: allowAll });
    expect(doc.servers?.[0]?.url).toBe('/api/catalog');
    for (const path of Object.keys(doc.paths)) {
      expect(path.startsWith('/api/catalog')).toBe(false);
    }
  });

  it('resolves every $ref to a declared component schema', () => {
    const doc = buildCatalogOpenApi();
    const schemas = doc.components?.schemas ?? {};
    const refs = JSON.stringify(doc).match(/"#\/components\/schemas\/[^"]+"/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = ref.slice('"#/components/schemas/'.length, -1);
      expect(schemas[name], `missing component schema '${name}'`).toBeDefined();
    }
  });
});
