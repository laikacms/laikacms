import type { AssetsRepository } from 'laikacms/assets';
import type { OpenApiDocument, OpenApiOperation, OpenApiPathItem } from 'laikacms/json-api';
import { describe, expect, it } from 'vitest';

import { buildAssetsOpenApi } from './openapi.js';
import { buildAssetsApi } from './server.js';

const stubRepo = {} as AssetsRepository;

const operationsOf = (item: OpenApiPathItem): OpenApiOperation[] =>
  (['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const)
    .map(method => item[method])
    .filter((op): op is OpenApiOperation => op !== undefined);

describe('GET /openapi.json', () => {
  it('returns 200 with Content-Type application/json', async () => {
    const api = buildAssetsApi({ repository: stubRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('serves an OpenAPI 3.1.0 document', async () => {
    const api = buildAssetsApi({ repository: stubRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Laika CMS Assets API');
  });

  it('servers[0].url reflects the request origin + basePath', async () => {
    const api = buildAssetsApi({ repository: stubRepo });
    const res = await api.fetch(new Request('https://cms.example.com/api/assets/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com/api/assets');
  });

  it('paths are exactly the routes the server implements', async () => {
    const api = buildAssetsApi({ repository: stubRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/capabilities',
      '/changes',
      '/openapi.json',
      '/resources',
      '/resources/{key}',
      '/sync-token',
    ]);
  });

  it('every operation has an operationId and a responses object', async () => {
    const api = buildAssetsApi({ repository: stubRepo });
    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    const operations = Object.values(doc.paths).flatMap(operationsOf);
    expect(operations.length).toBeGreaterThan(0);
    for (const op of operations) {
      expect(op.operationId).toBeTruthy();
      expect(op.responses).toBeTypeOf('object');
      expect(Object.keys(op.responses).length).toBeGreaterThan(0);
    }
  });

  it('a custom basePath passed to buildAssetsApi is reflected in the served document', async () => {
    const api = buildAssetsApi({ repository: stubRepo, basePath: '/custom/assets' });
    const res = await api.fetch(new Request('http://localhost/custom/assets/openapi.json'));
    expect(res.status).toBe(200);
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('http://localhost/custom/assets');
  });
});

describe('buildAssetsOpenApi', () => {
  it('defaults servers to the default basePath', () => {
    const doc = buildAssetsOpenApi();
    expect(doc.servers?.[0]?.url).toBe('/api/assets');
  });

  it('mentions the missing-authentication warning in the description', () => {
    const doc = buildAssetsOpenApi();
    expect(doc.info.description).toContain('no authentication');
  });
});
