import type { DocumentsRepository } from 'laikacms/documents';
import type { OpenApiDocument, OpenApiOperation, OpenApiPathItem } from 'laikacms/json-api';
import { describe, expect, it } from 'vitest';

import { buildDocumentsOpenApi } from './openapi.js';
import { buildJsonApi } from './server.js';

// The openapi.json route never touches the repository, so an empty stub suffices.
const stubRepo = {} as DocumentsRepository;

// Exactly the routes implemented by buildJsonApi's fetchInner (plus /openapi.json itself).
const expectedPaths = [
  '/',
  '/openapi.json',
  '/capabilities',
  '/records',
  '/record-summaries',
  '/published',
  '/published/{key}',
  '/published/{key}/unpublish',
  '/unpublished',
  '/unpublished/{key}',
  '/unpublished/{key}/publish',
  '/revisions',
  '/revisions/{key}',
  '/revisions/{key}/{revisionId}',
  '/operations',
];

const httpMethods = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

const operationsOf = (pathItem: OpenApiPathItem): OpenApiOperation[] =>
  httpMethods.flatMap(method => pathItem[method] ? [pathItem[method]!] : []);

describe('GET /openapi.json', () => {
  it('returns 200 with Content-Type application/json', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('serves an OpenAPI 3.1.0 document with the expected info fields', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Laika CMS Documents API');
    expect(doc.info.version).toBe('1.0.1');
    expect(doc.info.license).toEqual({ name: 'MIT', identifier: 'MIT' });
    expect(doc.info.description).toContain('JSON:API');
    expect(doc.info.description).toContain('no built-in authentication');
  });

  it('rewrites servers[0].url to the request origin plus basePath', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    expect(doc.servers).toHaveLength(1);
    expect(doc.servers![0]!.url).toBe('http://localhost');
  });

  it('documents exactly the implemented routes', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    expect(Object.keys(doc.paths).sort()).toEqual([...expectedPaths].sort());
  });

  it('gives every operation an operationId and at least one response', async () => {
    const api = buildJsonApi({ repo: stubRepo });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    const operations = Object.values(doc.paths).flatMap(operationsOf);
    expect(operations.length).toBeGreaterThanOrEqual(expectedPaths.length);
    for (const op of operations) {
      expect(op.operationId).toBeTruthy();
      expect(Object.keys(op.responses).length).toBeGreaterThan(0);
    }

    const operationIds = operations.map(op => op.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('reflects a custom basePath in the served document', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/documents' });
    const res = await api.fetch(new Request('https://cms.example.com/api/documents/openapi.json'));
    expect(res.status).toBe(200);

    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers![0]!.url).toBe('https://cms.example.com/api/documents');
    // Path keys stay relative to the basePath.
    expect(Object.keys(doc.paths).sort()).toEqual([...expectedPaths].sort());
  });
});

describe('buildDocumentsOpenApi', () => {
  it('defaults servers[0].url to "/" for the default (empty) basePath', () => {
    const doc = buildDocumentsOpenApi();
    expect(doc.servers![0]!.url).toBe('/');
  });

  it('uses the given basePath as the server url', () => {
    const doc = buildDocumentsOpenApi({ basePath: '/api/documents' });
    expect(doc.servers![0]!.url).toBe('/api/documents');
  });

  it('only references component schemas that exist', () => {
    const doc = buildDocumentsOpenApi();
    const defined = new Set(Object.keys(doc.components!.schemas!));
    const referenced = JSON.stringify(doc).match(/#\/components\/schemas\/([A-Za-z0-9]+)/g) ?? [];
    for (const r of referenced) {
      expect(defined).toContain(r.replace('#/components/schemas/', ''));
    }
  });

  it('PublishedCreateRequest requires data.id (LCMS-397)', () => {
    const doc = buildDocumentsOpenApi();
    const schemas = doc.components!.schemas! as Record<string, { properties?: { data?: { required?: string[] } } }>;
    expect(schemas['PublishedCreateRequest']!.properties!.data!.required).toContain('id');
  });

  it('UnpublishedCreateRequest requires data.id (LCMS-397)', () => {
    const doc = buildDocumentsOpenApi();
    const schemas = doc.components!.schemas! as Record<string, { properties?: { data?: { required?: string[] } } }>;
    expect(schemas['UnpublishedCreateRequest']!.properties!.data!.required).toContain('id');
  });

  it('RevisionCreateRequest requires data.id (LCMS-398)', () => {
    const doc = buildDocumentsOpenApi();
    const schemas = doc.components!.schemas! as Record<string, { properties?: { data?: { required?: string[] } } }>;
    expect(schemas['RevisionCreateRequest']!.properties!.data!.required).toContain('id');
  });
});
