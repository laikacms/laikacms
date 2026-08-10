import type { OpenApiDocument, OpenApiSchema } from 'laikacms/json-api';
import { describe, expect, it } from 'vitest';

import { buildAssetsOpenApi } from './assets-api/openapi.js';
import { buildCatalogOpenApi } from './catalog-api/openapi.js';
import { buildDocumentsOpenApi } from './documents-api/openapi.js';
import { buildStorageOpenApi } from './storage-api/openapi.js';

/**
 * Invariants every `api/*` OpenAPI document must satisfy, checked in one place
 * so a new surface (or a change to the shared component vocabulary in
 * `laikacms/json-api`) cannot satisfy them for three specs and quietly break
 * the fourth.
 */

const documents: Array<[name: string, doc: OpenApiDocument]> = [
  ['documents', buildDocumentsOpenApi()],
  ['storage', buildStorageOpenApi()],
  ['assets', buildAssetsOpenApi()],
  ['catalog', buildCatalogOpenApi()],
];

const refsInto = (doc: OpenApiDocument, section: string): string[] => {
  const pattern = new RegExp(`"#/components/${section}/([^"]+)"`, 'g');
  return [...JSON.stringify(doc).matchAll(pattern)].map(match => match[1]!);
};

describe.each(documents)('%s OpenAPI document', (_name, doc) => {
  it.each(['schemas', 'responses', 'parameters'])('resolves every $ref into components.%s', section => {
    const declared = new Set(
      Object.keys((doc.components as Record<string, Record<string, unknown>> | undefined)?.[section] ?? {}),
    );
    for (const name of refsInto(doc, section)) {
      expect(declared, `dangling #/components/${section}/${name}`).toContain(name);
    }
  });

  it('declares no component schema nothing references', () => {
    const referenced = new Set(refsInto(doc, 'schemas'));
    const orphans = Object.keys(doc.components?.schemas ?? {}).filter(name => !referenced.has(name));
    expect(orphans).toEqual([]);
  });

  it('folds repeated response bodies into components rather than inlining them', () => {
    // `compactOpenApiDocument` hoists any body used more than once, so no two
    // operations may still carry the same inline body.
    const bodies = Object.values(doc.paths)
      .flatMap(item => [item.get, item.put, item.post, item.patch, item.delete])
      .flatMap(operation => Object.values(operation?.responses ?? {}))
      .flatMap(response => '$ref' in response ? [] : [JSON.stringify({ ...response, description: undefined })])
      .filter(body => body !== JSON.stringify({ description: undefined }));

    expect(new Set(bodies).size).toBe(bodies.length);
  });
});

describe('shared JSON:API vocabulary', () => {
  const schemaOf = (doc: OpenApiDocument, name: string): OpenApiSchema | undefined => doc.components?.schemas?.[name];

  it('describes the error object identically everywhere', () => {
    // Every handler funnels failures through `errorToJsonApiMapper`, so a spec
    // that disagrees about the error shape is describing a fiction.
    const shapes = documents.map(([, doc]) => JSON.stringify(schemaOf(doc, 'JsonApiErrorObject')));
    expect(shapes.every(shape => shape !== undefined && shape === shapes[0])).toBe(true);
  });

  it('requires all four members the error mapper always emits', () => {
    const [, doc] = documents[0]!;
    expect((schemaOf(doc, 'JsonApiErrorObject') as { required: string[] }).required)
      .toEqual(['code', 'status', 'title', 'detail']);
  });

  it('never advertises a links.last no link builder can produce', () => {
    for (const [name, doc] of documents) {
      const links = schemaOf(doc, 'PaginationLinks') as { properties?: Record<string, unknown> } | undefined;
      expect(Object.keys(links?.properties ?? {}), name).not.toContain('last');
    }
  });
});
