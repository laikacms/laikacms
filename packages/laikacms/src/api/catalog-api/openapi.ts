import type { OpenApiDocument, OpenApiResponse, OpenApiSchema } from 'laikacms/json-api';
import {
  compactOpenApiDocument,
  jsonApiContent,
  jsonApiErrorComponents,
  jsonApiErrorResponseComponents,
  schemaRef as ref,
} from 'laikacms/json-api';

export interface CatalogOpenApiOptions {
  basePath?: string;
}

// Authored inline so every operation keeps its own wording; the document is run
// through `compactOpenApiDocument` on the way out, which folds each occurrence
// into a `$ref` against the `ErrorResponse` component.
const errorResponse = (description: string): OpenApiResponse => ({
  description,
  content: jsonApiContent(ref('JsonApiError')),
});

const collectionResponse = (description: string): OpenApiResponse => ({
  description,
  content: jsonApiContent(ref('CollectionDocument')),
});

const schemas: Record<string, OpenApiSchema> = {
  // This handler never attaches meta.warnings to a successful response.
  ...jsonApiErrorComponents({ warnings: false }),

  UnpublishedStatusConfig: {
    type: 'object',
    properties: {
      directory: { type: 'string', description: 'Directory where documents with this status are stored.' },
      name: { type: 'string', description: 'Human-readable name for this status.' },
    },
    required: ['directory', 'name'],
  },
  DocumentCollectionAttributes: {
    type: 'object',
    properties: {
      type: { type: 'string', const: 'document' },
      name: { type: 'string', description: 'Human-readable label.' },
      directory: { type: 'string', description: 'Storage root directory for this collection.' },
      recursive: { type: 'boolean', description: 'Include sub-directories in listings.' },
      format: { type: 'string', description: 'Default file format (e.g. "markdown").' },
      documentTitleKey: { type: 'string', description: 'Frontmatter key used as the document title.' },
      documentDescriptionKey: { type: 'string', description: 'Frontmatter key used as the document description.' },
      documentStatusKey: { type: 'string', description: 'Frontmatter key used as the document status.' },
      unpublishedStatuses: {
        type: 'object',
        description: 'Map of unpublished status values to their configuration.',
        additionalProperties: ref('UnpublishedStatusConfig'),
      },
      revisionDirectory: { type: 'string', description: 'Directory for revision snapshots.' },
      draftDirectory: {
        type: 'string',
        description:
          'Shorthand for unpublishedStatuses.draft.directory (name defaults to "Draft"). Explicit unpublishedStatuses.draft wins if both are provided.',
      },
      archiveDirectory: {
        type: 'string',
        description:
          'Shorthand for unpublishedStatuses.archived.directory (name defaults to "Archived"). Explicit unpublishedStatuses.archived wins if both are provided.',
      },
      trashDirectory: {
        type: 'string',
        description:
          'Shorthand for unpublishedStatuses.trash.directory (name defaults to "Trash"). Explicit unpublishedStatuses.trash wins if both are provided.',
      },
    },
    required: ['type'],
  },
  MediaCollectionAttributes: {
    type: 'object',
    properties: {
      type: { type: 'string', const: 'media' },
      name: { type: 'string', description: 'Human-readable label.' },
      directory: { type: 'string', description: 'Storage root directory for this collection.' },
      recursive: { type: 'boolean', description: 'Include sub-directories in listings.' },
      accept: {
        type: 'array',
        items: { type: 'string' },
        description: 'Allowed MIME types or file extensions.',
      },
      url: { type: 'string', description: 'Public URL prefix for served media files.' },
      pathFormat: { type: 'string', description: 'Template for generating media file paths.' },
    },
    required: ['type'],
  },
  DocumentCollectionResource: {
    type: 'object',
    properties: {
      type: { type: 'string', const: 'document-collection' },
      id: { type: 'string', description: 'Collection key.' },
      attributes: ref('DocumentCollectionAttributes'),
    },
    required: ['type', 'id', 'attributes'],
  },
  MediaCollectionResource: {
    type: 'object',
    properties: {
      type: { type: 'string', const: 'media-collection' },
      id: { type: 'string', description: 'Collection key.' },
      attributes: ref('MediaCollectionAttributes'),
    },
    required: ['type', 'id', 'attributes'],
  },
  CollectionResource: {
    oneOf: [
      ref('DocumentCollectionResource'),
      ref('MediaCollectionResource'),
    ],
  },
  CollectionDocument: {
    type: 'object',
    properties: {
      data: ref('CollectionResource'),
    },
    required: ['data'],
  },
  CollectionListDocument: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: ref('CollectionResource'),
      },
    },
    required: ['data'],
  },
};

export function buildCatalogOpenApi(options: CatalogOpenApiOptions = {}): OpenApiDocument {
  const { basePath = '' } = options;

  return compactOpenApiDocument({
    openapi: '3.1.0',
    info: {
      title: 'Laika CMS Catalog API',
      version: '1.0.1',
      license: { name: 'MIT', identifier: 'MIT' },
      description: 'JSON:API-style server for catalog collection settings (document and media collections). '
        + 'All responses carry Cache-Control: no-store. '
        + 'Warning: this API ships no built-in authentication — wrap the handler with an authentication '
        + 'layer before exposing it to an untrusted network, otherwise anyone who can reach it can read, '
        + 'mutate, and delete collection settings.',
    },
    servers: [{ url: basePath === '' ? '/' : basePath }],
    tags: [
      { name: 'collections', description: 'Catalog collection settings.' },
      { name: 'openapi', description: 'API metadata.' },
    ],
    paths: {
      '/openapi.json': {
        get: {
          operationId: 'getOpenApiDocument',
          summary: 'Get the OpenAPI 3.1 document describing this API',
          tags: ['openapi'],
          responses: {
            '200': {
              description: 'The OpenAPI document.',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/openapi.yaml': {
        get: {
          operationId: 'getOpenApiDocumentYaml',
          summary: 'Get the OpenAPI 3.1 document describing this API, as YAML',
          tags: ['openapi'],
          responses: {
            '200': {
              description: 'The OpenAPI document, serialized as YAML.',
              content: {
                'application/yaml': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/collections': {
        get: {
          operationId: 'listCollections',
          summary: 'List all collections',
          tags: ['collections'],
          responses: {
            '200': {
              description: 'All configured collections.',
              content: jsonApiContent(ref('CollectionListDocument')),
            },
            '400': errorResponse('The settings provider failed to load settings.'),
            '503': errorResponse('Downstream service (e.g. DynamoDB) unreachable.'),
          },
        },
        post: {
          operationId: 'createCollection',
          summary: 'Create a collection',
          tags: ['collections'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('CollectionDocument')),
          },
          responses: {
            '201': collectionResponse('The created collection.'),
            '400': errorResponse('Malformed body, invalid JSON:API schema, or the settings provider failed.'),
            '503': errorResponse('Downstream service (e.g. DynamoDB) unreachable.'),
          },
        },
      },
      '/collections/{key}': {
        parameters: [
          {
            name: 'key',
            in: 'path',
            required: true,
            description: 'Collection key (JSON:API resource id).',
            schema: { type: 'string' },
          },
        ],
        get: {
          operationId: 'getCollection',
          summary: 'Read a single collection',
          tags: ['collections'],
          responses: {
            '200': collectionResponse('The requested collection.'),
            '400': errorResponse('The settings provider failed, or the collection has an unknown type.'),
            '404': errorResponse('Collection key does not exist.'),
            '503': errorResponse('Downstream service (e.g. DynamoDB) unreachable.'),
          },
        },
        patch: {
          operationId: 'updateCollection',
          summary: 'Update a collection',
          tags: ['collections'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('CollectionDocument')),
          },
          responses: {
            '200': collectionResponse('The updated collection.'),
            '400': errorResponse('Malformed body, invalid JSON:API schema, or the settings provider failed.'),
            '404': errorResponse('Collection key does not exist.'),
            '409': errorResponse('Body data.id does not match the URL key.'),
            '503': errorResponse('Downstream service (e.g. DynamoDB) unreachable.'),
          },
        },
        delete: {
          operationId: 'deleteCollection',
          summary: 'Delete a collection',
          tags: ['collections'],
          responses: {
            '204': { description: 'Collection deleted. Empty body.' },
            '400': errorResponse('The settings provider failed to load or persist settings.'),
            '404': errorResponse('Collection key does not exist.'),
            '503': errorResponse('Downstream service (e.g. DynamoDB) unreachable.'),
          },
        },
      },
    },
    components: { schemas, responses: jsonApiErrorResponseComponents() },
  });
}
