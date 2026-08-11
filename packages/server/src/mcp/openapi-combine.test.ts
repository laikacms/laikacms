import type { OpenApiDocument } from 'laikacms/json-api';
import { describe, expect, it } from 'vitest';
import { buildLaikaApiOpenApi, combineOpenApiDocuments } from './openapi-combine.js';
import { readApiSpec, sliceOpenApiDocument } from './openapi-slice.js';

const documentsSource = {
  openapi: '3.1.0',
  info: { title: 'Laika CMS Documents API', version: '1.0.1' },
  servers: [{ url: '/' }],
  tags: [{ name: 'published', description: 'Published documents.' }],
  paths: {
    '/': {
      get: { tags: ['info'], summary: 'List available endpoints', responses: {} },
    },
    '/published/{key}': {
      get: {
        tags: ['published'],
        summary: 'Read a published document',
        responses: { 200: { $ref: '#/components/responses/Published' } },
      },
    },
  },
  components: {
    responses: {
      Published: { content: { 'application/vnd.api+json': { schema: { $ref: '#/components/schemas/Resource' } } } },
    },
    schemas: { Resource: { type: 'object' } },
  },
} as unknown as OpenApiDocument;

const storageSource = {
  openapi: '3.1.0',
  info: { title: 'Laika CMS Storage API', version: '1.0.1' },
  servers: [{ url: '/' }],
  tags: [{ name: 'objects' }],
  paths: {
    '/objects/{key}': {
      get: {
        tags: ['objects'],
        summary: 'Read an object',
        // Same component name as the documents source - the merge must keep them apart.
        responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Resource' } } } } },
      },
    },
  },
  components: { schemas: { Resource: { type: 'string' } } },
} as unknown as OpenApiDocument;

const combined = () =>
  combineOpenApiDocuments({
    basePath: '/api',
    sources: [
      { mount: 'documents', document: documentsSource },
      { mount: 'storage', document: storageSource },
    ],
  });

describe('combineOpenApiDocuments', () => {
  it('remounts every path under its mount segment, mapping "/" to the segment itself', () => {
    expect(Object.keys(combined().paths).sort()).toEqual([
      '/documents',
      '/documents/published/{key}',
      '/storage/objects/{key}',
    ]);
  });

  it('serves the combined base path as servers[0].url', () => {
    expect(combined().servers).toEqual([{ url: '/api' }]);
    expect(combineOpenApiDocuments({ sources: [] }).servers).toEqual([{ url: '/' }]);
  });

  it('namespaces tags per mount, on the tag list and on every operation', () => {
    const document = combined();
    expect(document.tags).toContainEqual({ name: 'documents/published', description: 'Published documents.' });
    expect(document.tags).toContainEqual({ name: 'storage/objects' });
    const operation = document.paths['/documents/published/{key}']?.get;
    expect(operation?.tags).toEqual(['documents/published']);
  });

  it('keeps colliding component names apart by prefixing them per source, rewriting $refs', () => {
    const schemas = combined().components?.schemas ?? {};
    expect(schemas.DocumentsResource).toEqual({ type: 'object' });
    expect(schemas.StorageResource).toEqual({ type: 'string' });
    expect(schemas).not.toHaveProperty('Resource');
    expect(JSON.stringify(combined())).not.toContain('#/components/schemas/Resource"');
  });

  it('produces a document the slicer resolves without dangling $refs', () => {
    const { document } = sliceOpenApiDocument(combined(), { paths: ['/api/documents/published/{key}'] });
    expect(Object.keys(document?.components?.responses ?? {})).toEqual(['DocumentsPublished']);
    expect(Object.keys(document?.components?.schemas ?? {})).toEqual(['DocumentsResource']);
  });

  it('does not mutate its sources', () => {
    const before = JSON.stringify(documentsSource);
    combined();
    expect(JSON.stringify(documentsSource)).toBe(before);
  });

  it('rejects an empty mount segment instead of silently colliding paths', () => {
    expect(() => combineOpenApiDocuments({ sources: [{ mount: '/', document: storageSource }] }))
      .toThrow(/empty mount segment/);
  });
});

describe('buildLaikaApiOpenApi', () => {
  it('mounts the documents, storage and assets APIs under the laikaApi segments', () => {
    const document = buildLaikaApiOpenApi({ basePath: '/api' });
    const paths = Object.keys(document.paths);
    expect(paths).toContain('/documents/records');
    expect(paths).toContain('/storage/objects/{key}');
    expect(paths.some(path => path.startsWith('/assets'))).toBe(true);
    expect(document.servers).toEqual([{ url: '/api' }]);
  });

  it('omits the assets API when the deployment has none', () => {
    const paths = Object.keys(buildLaikaApiOpenApi({ assets: false }).paths);
    expect(paths.some(path => path.startsWith('/assets'))).toBe(false);
    expect(paths).toContain('/documents/records');
  });

  it('feeds the read_api_spec index without a single dangling reference in any slice', () => {
    const document = buildLaikaApiOpenApi();
    const index = readApiSpec(document);
    expect(index).toContain('## documents/published');
    expect(index).toContain('## storage/objects');

    const parsed = JSON.parse(readApiSpec(document, { paths: ['/documents/records'] })) as {
      components?: Record<string, Record<string, unknown>>,
    };
    const refs: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value !== 'object' || value === null) return;
      for (const [key, entry] of Object.entries(value)) {
        if (key === '$ref' && typeof entry === 'string') refs.push(entry);
        else walk(entry);
      }
    };
    walk(parsed);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const [, , section, name] = ref.split('/');
      expect(parsed.components?.[section]?.[name], `dangling ${ref}`).toBeDefined();
    }
  });
});
