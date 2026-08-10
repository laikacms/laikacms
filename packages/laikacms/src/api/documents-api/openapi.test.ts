import { load } from 'js-yaml';
import type { DocumentsRepository } from 'laikacms/documents';
import type { OpenApiDocument, OpenApiOperation, OpenApiPathItem } from 'laikacms/json-api';
import { describe, expect, it } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import { buildDocumentsOpenApi } from './openapi.js';
import { buildJsonApi } from './server.js';

// The openapi.json route never touches the repository, so an empty stub suffices.
const stubRepo = {} as DocumentsRepository;

// Exactly the routes implemented by buildJsonApi's fetchInner (plus /openapi.json itself).
const expectedPaths = [
  '/',
  '/openapi.json',
  '/openapi.yaml',
  '/capabilities',
  '/sync-token',
  '/changes',
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
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('serves an OpenAPI 3.1.0 document with the expected info fields', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
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
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    expect(doc.servers).toHaveLength(1);
    expect(doc.servers![0]!.url).toBe('http://localhost');
  });

  it('documents exactly the implemented routes', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    expect(Object.keys(doc.paths).sort()).toEqual([...expectedPaths].sort());
  });

  it('gives every operation an operationId and at least one response', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
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
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/documents', authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/api/documents/openapi.json'));
    expect(res.status).toBe(200);

    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers![0]!.url).toBe('https://cms.example.com/api/documents');
    // Path keys stay relative to the basePath.
    expect(Object.keys(doc.paths).sort()).toEqual([...expectedPaths].sort());
  });
});

describe('GET /openapi.yaml', () => {
  it('returns 200 with Content-Type application/yaml', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.yaml'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/yaml');
  });

  it('serves the same document as YAML with servers[0].url rewritten', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/documents', authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/api/documents/openapi.yaml'));
    const doc = load(await res.text()) as OpenApiDocument;

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Laika CMS Documents API');
    expect(doc.servers![0]!.url).toBe('https://cms.example.com/api/documents');
    expect(Object.keys(doc.paths).sort()).toEqual([...expectedPaths].sort());
  });
});

describe('buildDocumentsOpenApi', () => {
  it('defaults servers[0].url to "/" for the default (empty) basePath', () => {
    const doc = buildDocumentsOpenApi();
    expect(doc.servers![0]!.url).toBe('/');
  });

  it('uses the given basePath as the server url', () => {
    const doc = buildDocumentsOpenApi({ basePath: '/api/documents', authorize: allowAll });
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

  // The `data` member of a write request is a $ref to a shared `*WriteData`
  // component, so the requirement lives one hop away from the request schema.
  const requiredOfWriteData = (doc: OpenApiDocument, requestName: string): string[] => {
    const schemas = doc.components!.schemas! as Record<
      string,
      { required?: string[], properties?: { data?: { $ref?: string, required?: string[] } } }
    >;
    const data = schemas[requestName]!.properties!.data!;
    const target = data.$ref ? schemas[data.$ref.replace('#/components/schemas/', '')]! : data;
    return target.required ?? [];
  };

  it('PublishedCreateRequest requires data.id (LCMS-397)', () => {
    expect(requiredOfWriteData(buildDocumentsOpenApi(), 'PublishedCreateRequest')).toContain('id');
  });

  it('UnpublishedCreateRequest requires data.id (LCMS-397)', () => {
    expect(requiredOfWriteData(buildDocumentsOpenApi(), 'UnpublishedCreateRequest')).toContain('id');
  });

  it('RevisionCreateRequest requires data.id (LCMS-398)', () => {
    expect(requiredOfWriteData(buildDocumentsOpenApi(), 'RevisionCreateRequest')).toContain('id');
  });

  it('POST create endpoints declare 409 for duplicate-key conflict (LCMS-287)', () => {
    const doc = buildDocumentsOpenApi();
    const paths = doc.paths as Record<string, { post?: { responses: Record<string, unknown> } }>;
    expect(Object.keys(paths['/published']!.post!.responses)).toContain('409');
    expect(Object.keys(paths['/unpublished']!.post!.responses)).toContain('409');
    expect(Object.keys(paths['/revisions']!.post!.responses)).toContain('409');
  });

  it('DELETE /unpublished/{key} declares 404 for missing draft (LCMS-287)', () => {
    const doc = buildDocumentsOpenApi();
    const paths = doc.paths as Record<string, { delete?: { responses: Record<string, unknown> } }>;
    expect(Object.keys(paths['/unpublished/{key}']!.delete!.responses)).toContain('404');
  });
});
