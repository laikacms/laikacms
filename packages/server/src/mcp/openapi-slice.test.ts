import type { OpenApiDocument } from 'laikacms/json-api';
import { describe, expect, it } from 'vitest';
import { buildSpecIndex, hasSliceFilter, readApiSpec, sliceOpenApiDocument } from './openapi-slice.js';

const DOC = {
  openapi: '3.1.0',
  info: { title: 'Laika CMS API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  tags: [{ name: 'documents/published' }, { name: 'storage/objects' }, { name: 'unused' }],
  paths: {
    '/storage/objects': {
      get: {
        tags: ['storage/objects'],
        summary: 'List objects',
        responses: {
          200: { content: { 'application/vnd.api+json': { schema: { $ref: '#/components/schemas/ObjectList' } } } },
        },
      },
    },
    '/documents/published': {
      get: {
        tags: ['documents/published'],
        summary: 'List published documents',
        responses: { 200: { $ref: '#/components/responses/Published' } },
      },
    },
    '/documents/published/{key}': {
      parameters: [{ $ref: '#/components/parameters/Key' }],
      get: { tags: ['documents/published'], summary: 'Read one published document', responses: {} },
      delete: {
        tags: ['documents/published'],
        summary: 'Remove a published document',
        deprecated: true,
        responses: {},
      },
    },
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    parameters: { Key: { name: 'key', in: 'path' } },
    responses: {
      Published: { content: { 'application/vnd.api+json': { schema: { $ref: '#/components/schemas/Published' } } } },
    },
    schemas: {
      ObjectList: { type: 'array', items: { $ref: '#/components/schemas/StorageObject' } },
      StorageObject: { type: 'object' },
      // Reached only through Published -> DocumentContent: the closure must walk both.
      Published: { type: 'object', properties: { content: { $ref: '#/components/schemas/DocumentContent' } } },
      DocumentContent: { type: 'object' },
      Unrelated: { type: 'object' },
    },
  },
} as unknown as OpenApiDocument;

interface ParsedSlice {
  openapi?: string;
  info?: { title?: string };
  paths?: Record<string, unknown>;
  components?: Record<string, Record<string, unknown>>;
  'x-slice'?: { note?: string, filter?: unknown, unmatchedRequests?: string[] };
}

describe('buildSpecIndex', () => {
  it('lists every operation grouped by tag, with method, path and summary', () => {
    const index = buildSpecIndex(DOC);
    expect(index).toContain('## documents/published');
    expect(index).toContain('GET    /documents/published - List published documents');
    expect(index).toContain('DELETE /documents/published/{key} - Remove a published document [deprecated]');
    expect(index).toContain('## storage/objects');
    expect(index).toContain('3 paths, 4 operations');
  });

  it('omits schemas entirely - it is a menu, not the contract', () => {
    const index = buildSpecIndex(DOC);
    expect(index).not.toContain('DocumentContent');
    expect(index).not.toContain('$ref');
  });
});

describe('sliceOpenApiDocument', () => {
  it('keeps only the requested path', () => {
    const { document, matchedPaths } = sliceOpenApiDocument(DOC, { paths: ['/storage/objects'] });
    expect(matchedPaths).toEqual(['/storage/objects']);
    expect(Object.keys(document?.paths ?? {})).toEqual(['/storage/objects']);
  });

  it('accepts the server base-path prefix api_request uses', () => {
    const { matchedPaths } = sliceOpenApiDocument(DOC, { paths: ['/api/storage/objects'] });
    expect(matchedPaths).toEqual(['/storage/objects']);
  });

  it('treats a path prefix as "this and everything under it"', () => {
    const { matchedPaths } = sliceOpenApiDocument(DOC, { paths: ['/documents/published'] });
    expect(matchedPaths).toEqual(['/documents/published', '/documents/published/{key}']);
  });

  it('matches a path parameter under any name', () => {
    const { matchedPaths } = sliceOpenApiDocument(DOC, { paths: ['/documents/published/{id}'] });
    expect(matchedPaths).toEqual(['/documents/published/{key}']);
  });

  it('pulls in the transitive $ref closure and nothing else', () => {
    const { document } = sliceOpenApiDocument(DOC, { paths: ['/documents/published'] });
    expect(Object.keys(document?.components?.schemas ?? {}).sort()).toEqual(['DocumentContent', 'Published']);
    expect(Object.keys(document?.components?.responses ?? {})).toEqual(['Published']);
    expect(document?.components?.schemas).not.toHaveProperty('StorageObject');
  });

  it('keeps path-level parameters and their components', () => {
    const { document } = sliceOpenApiDocument(DOC, { paths: ['/documents/published/{key}'] });
    expect(document?.paths?.['/documents/published/{key}']).toHaveProperty('parameters');
    expect(Object.keys(document?.components?.parameters ?? {})).toEqual(['Key']);
  });

  it('always keeps securitySchemes so the slice still says how to authenticate', () => {
    const { document } = sliceOpenApiDocument(DOC, { paths: ['/storage/objects'] });
    expect((document?.components as Record<string, unknown>)?.securitySchemes).toHaveProperty('bearer');
  });

  it('filters by tag, dropping non-matching methods of a kept path', () => {
    const { matchedPaths } = sliceOpenApiDocument(DOC, { tag: 'storage/objects' });
    expect(matchedPaths).toEqual(['/storage/objects']);
  });

  it('filters by free-text search across path, summary and tags', () => {
    const { matchedPaths } = sliceOpenApiDocument(DOC, { search: 'remove' });
    expect(matchedPaths).toEqual(['/documents/published/{key}']);
    const methods = Object.keys(
      sliceOpenApiDocument(DOC, { search: 'remove' }).document?.paths?.['/documents/published/{key}'] ?? {},
    );
    expect(methods).toContain('delete');
    expect(methods).not.toContain('get');
  });

  it('combines filters with AND', () => {
    expect(sliceOpenApiDocument(DOC, { paths: ['/documents/published'], tag: 'storage/objects' }).document).toBeNull();
  });

  it('drops tags no kept operation uses', () => {
    const { document } = sliceOpenApiDocument(DOC, { tag: 'storage/objects' });
    expect(document?.tags).toEqual([{ name: 'storage/objects' }]);
  });

  it('reports requested paths that matched nothing', () => {
    const { matchedPaths, unmatchedRequests } = sliceOpenApiDocument(DOC, {
      paths: ['/documents/published', '/nope'],
    });
    expect(matchedPaths).toContain('/documents/published');
    expect(unmatchedRequests).toEqual(['/nope']);
  });
});

describe('readApiSpec', () => {
  it('returns the index when unfiltered', () => {
    expect(readApiSpec(DOC)).toContain('OpenAPI 3.1.0 INDEX');
    expect(hasSliceFilter({})).toBe(false);
  });

  it('returns a parseable OpenAPI document when filtered', () => {
    const parsed = JSON.parse(readApiSpec(DOC, { paths: ['/documents/published'] })) as ParsedSlice;
    expect(parsed.openapi).toBe('3.1.0');
    expect(parsed.info?.title).toBe('Laika CMS API');
    expect(parsed['x-slice']?.note).toContain('2 of 3 paths');
    expect(parsed['x-slice']?.filter).toEqual({ paths: ['/documents/published'] });
  });

  it('leaves no dangling $ref in a slice', () => {
    const parsed = JSON.parse(readApiSpec(DOC, { paths: ['/documents/published'] })) as ParsedSlice;
    const refs: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value !== 'object' || value === null) return;
      for (const [key, entry] of Object.entries(value)) {
        if (key === '$ref' && typeof entry === 'string') refs.push(entry);
        else walk(entry);
      }
    };
    walk(parsed.paths);
    walk(parsed.components);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const [, , section, name] = ref.split('/');
      expect(parsed.components?.[section]?.[name], `dangling ${ref}`).toBeDefined();
    }
  });

  it('explains itself instead of returning an empty document when nothing matches', () => {
    const text = readApiSpec(DOC, { paths: ['/nope'] });
    expect(text).toContain('No operation matched');
    expect(text).toContain('/nope');
  });
});
