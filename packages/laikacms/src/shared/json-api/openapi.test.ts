import { describe, expect, it } from 'vitest';

import { jsonApiContent, jsonApiErrorResponseComponents, schemaRef } from './openapi-components.js';
import { compactOpenApiDocument, type OpenApiDocument, type OpenApiResponse } from './openapi.js';

const errorBody = () => ({ content: jsonApiContent(schemaRef('JsonApiError')) });

const pageParameter = () => ({
  name: 'page[size]',
  in: 'query' as const,
  description: 'Items per page.',
  schema: { type: 'integer' },
});

const baseDocument = (): OpenApiDocument => ({
  openapi: '3.1.0',
  info: { title: 'Test', version: '1.0.0' },
  paths: {},
});

/**
 * Resolve the `$ref`s `compactOpenApiDocument` introduced, so a compacted
 * document can be compared against the one it was built from.
 */
function dereference(doc: OpenApiDocument): OpenApiDocument {
  const sections = doc.components as Record<string, Record<string, unknown>> | undefined;
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (typeof value !== 'object' || value === null) return value;
    const entries = value as Record<string, unknown>;
    const pointer = entries['$ref'];
    if (typeof pointer === 'string' && pointer.startsWith('#/components/')) {
      const [, , section, name] = pointer.split('/');
      const target = sections?.[section!]?.[name!];
      if (target) {
        const { $ref: _ignored, ...overrides } = entries;
        return { ...(target as Record<string, unknown>), ...overrides };
      }
    }
    return Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, resolve(entry)]));
  };
  const { components: _components, ...rest } = doc;
  return resolve(rest) as OpenApiDocument;
}

describe('compactOpenApiDocument', () => {
  it('hoists a response body used by more than one operation', () => {
    const doc = compactOpenApiDocument({
      ...baseDocument(),
      paths: {
        '/a': { get: { operationId: 'a', responses: { '404': { description: 'No a.', ...errorBody() } } } },
        '/b': { get: { operationId: 'b', responses: { '404': { description: 'No b.', ...errorBody() } } } },
      },
    });

    const [name] = Object.keys(doc.components!.responses!);
    expect(doc.paths['/a']!.get!.responses['404']).toHaveProperty('$ref', `#/components/responses/${name}`);
    expect(doc.paths['/b']!.get!.responses['404']).toEqual({
      // The first wording wins the definition's own description; the other
      // operation keeps its wording as a sibling override.
      $ref: `#/components/responses/${name}`,
      description: 'No b.',
    });
    expect(doc.components!.responses![name!]).toEqual({ description: 'No a.', ...errorBody() });
  });

  it('leaves a response body used only once inline', () => {
    const doc = compactOpenApiDocument({
      ...baseDocument(),
      paths: {
        '/a': { get: { operationId: 'a', responses: { '404': { description: 'No a.', ...errorBody() } } } },
      },
    });

    expect(doc.paths['/a']!.get!.responses['404']).toHaveProperty('description', 'No a.');
    expect(doc.components?.responses).toBeUndefined();
  });

  it('reuses a pre-declared component instead of minting a twin', () => {
    const doc = compactOpenApiDocument({
      ...baseDocument(),
      paths: {
        '/a': { get: { operationId: 'a', responses: { '404': { description: 'No a.', ...errorBody() } } } },
      },
      components: { responses: jsonApiErrorResponseComponents() },
    });

    expect(Object.keys(doc.components!.responses!)).toEqual(['ErrorResponse']);
    expect(doc.paths['/a']!.get!.responses['404']).toEqual({
      $ref: '#/components/responses/ErrorResponse',
      description: 'No a.',
    });
  });

  it('drops the sibling description when it matches the component default', () => {
    const shared: OpenApiResponse = { description: 'Same.', ...errorBody() };
    const doc = compactOpenApiDocument({
      ...baseDocument(),
      paths: {
        '/a': { get: { operationId: 'a', responses: { '404': { ...shared } } } },
        '/b': { get: { operationId: 'b', responses: { '404': { ...shared } } } },
      },
    });

    expect(doc.paths['/a']!.get!.responses['404']).not.toHaveProperty('description');
  });

  it('hoists a parameter repeated across operations and path items', () => {
    const doc = compactOpenApiDocument({
      ...baseDocument(),
      paths: {
        '/a': { parameters: [pageParameter()], get: { operationId: 'a', responses: {} } },
        '/b': { get: { operationId: 'b', parameters: [pageParameter()], responses: {} } },
      },
    });

    const [name] = Object.keys(doc.components!.parameters!);
    expect(doc.paths['/a']!.parameters).toEqual([{ $ref: `#/components/parameters/${name}` }]);
    expect(doc.paths['/b']!.get!.parameters).toEqual([{ $ref: `#/components/parameters/${name}` }]);
  });

  it('is lossless once the refs it introduced are resolved', () => {
    const source: OpenApiDocument = {
      ...baseDocument(),
      paths: {
        '/a': {
          parameters: [pageParameter()],
          get: {
            operationId: 'a',
            responses: { '404': { description: 'No a.', ...errorBody() }, '204': { description: 'Gone.' } },
          },
        },
        '/b': {
          get: {
            operationId: 'b',
            parameters: [pageParameter()],
            responses: { '404': { description: 'No b.', ...errorBody() } },
          },
        },
      },
    };

    expect(dereference(compactOpenApiDocument(source))).toEqual(source);
  });

  it('does not mutate the document it was given', () => {
    const source: OpenApiDocument = {
      ...baseDocument(),
      paths: {
        '/a': { get: { operationId: 'a', responses: { '404': { description: 'No a.', ...errorBody() } } } },
        '/b': { get: { operationId: 'b', responses: { '404': { description: 'No b.', ...errorBody() } } } },
      },
    };
    const before = JSON.stringify(source);

    compactOpenApiDocument(source);

    expect(JSON.stringify(source)).toBe(before);
  });
});
