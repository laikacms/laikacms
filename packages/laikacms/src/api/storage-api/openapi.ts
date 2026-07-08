import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSchema,
} from 'laikacms/json-api';

const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

const ref = (name: string): OpenApiSchema => ({ $ref: `#/components/schemas/${name}` });

const jsonApiResponse = (description: string, schemaName: string): OpenApiResponse => ({
  description,
  content: { [JSON_API_CONTENT_TYPE]: { schema: ref(schemaName) } },
});

const errorResponse = (description: string): OpenApiResponse => jsonApiResponse(description, 'JsonApiError');

// Repository failures are translated to HTTP statuses via ErrorCodeToStatusMap
// (not_found → 404, bad_request/invalid_data → 400, internal → 500, …), so the
// exact status of a failed repo call depends on the backend's error code.
const mappedRepositoryError = errorResponse(
  'Repository failure. The status code is mapped from the underlying error code '
    + '(e.g. not_found → 404, bad_request → 400, internal → 500).',
);

const keyPathParameter = (description: string): OpenApiParameter => ({
  name: 'key',
  in: 'path',
  required: true,
  description: `${description} Keys containing slashes must be URL-encoded (\`/\` → \`%2F\`) `
    + 'so the key survives routing as a single path segment.',
  schema: { type: 'string' },
});

const listQueryParameters: OpenApiParameter[] = [
  {
    name: 'page[number]',
    in: 'query',
    description: 'Page number for page-based pagination (1-based).',
    schema: { type: 'integer', minimum: 1 },
  },
  {
    name: 'page[size]',
    in: 'query',
    description: 'Items per page for page- and cursor-based pagination. '
      + 'When no page[*] parameter is present at all, the server lists with a default page size of 100.',
    schema: { type: 'integer', minimum: 1 },
  },
  {
    name: 'page[offset]',
    in: 'query',
    description: 'Zero-based offset for offset-based pagination.',
    schema: { type: 'integer', minimum: 0 },
  },
  {
    name: 'page[limit]',
    in: 'query',
    description: 'Maximum number of items for offset-based pagination.',
    schema: { type: 'integer', minimum: 1 },
  },
  {
    name: 'page[after]',
    in: 'query',
    description: 'Forward cursor. Rejected with 400 when the backend capabilities report '
      + '`pagination.styles.cursor: false` — consult GET /capabilities first.',
    schema: { type: 'string' },
  },
  {
    name: 'page[before]',
    in: 'query',
    description: 'Backward cursor. Rejected with 400 when the backend capabilities report '
      + '`pagination.styles.cursor: false` — consult GET /capabilities first.',
    schema: { type: 'string' },
  },
  {
    name: 'filter[depth]',
    in: 'query',
    description: 'Recursion depth for the folder walk. Values that are not integers >= 1 fall back to 1.',
    schema: { type: 'integer', minimum: 1, default: 1 },
  },
];

const jsonApiRequestBody = (description: string, schemaName: string): OpenApiRequestBody => ({
  description,
  required: true,
  content: { [JSON_API_CONTENT_TYPE]: { schema: ref(schemaName) } },
});

const listAtomsOperation = (operationId: string, summary: string, keyed: boolean): OpenApiOperation => ({
  operationId,
  summary,
  tags: ['atoms'],
  parameters: listQueryParameters,
  responses: {
    '200': jsonApiResponse(
      'Atoms in the folder, with pagination links and optional meta.page.total / meta.warnings.',
      'AtomCollectionResponse',
    ),
    '400': errorResponse('Cursor pagination (page[after] / page[before]) requested but unsupported by the backend.'),
    ...(keyed ? { '404': errorResponse('Folder not found.') } : {}),
    default: mappedRepositoryError,
  },
});

const listAtomSummariesOperation = (operationId: string, summary: string, keyed: boolean): OpenApiOperation => {
  const base = listAtomsOperation(operationId, summary, keyed);
  return {
    ...base,
    responses: {
      ...base.responses,
      '200': jsonApiResponse(
        'Atom summaries in the folder, with pagination links and optional meta.page.total / meta.warnings.',
        'AtomSummaryCollectionResponse',
      ),
    },
  };
};

const schemas: Record<string, OpenApiSchema> = {
  JsonApiErrorObject: {
    type: 'object',
    description: 'A single JSON:API error object as produced by the error responder.',
    required: ['code', 'status', 'title', 'detail'],
    properties: {
      code: { type: 'string', description: 'Machine-readable error code, e.g. not_found, invalid_data.' },
      status: { type: 'string', description: 'HTTP status code as a string.' },
      title: { type: 'string' },
      detail: { type: 'string' },
      source: {
        type: 'object',
        properties: {
          pointer: { type: 'string' },
          parameter: { type: 'string' },
        },
      },
    },
  },
  JsonApiError: {
    type: 'object',
    required: ['errors'],
    properties: {
      errors: { type: 'array', items: ref('JsonApiErrorObject') },
    },
  },
  Warnings: {
    type: 'array',
    description: 'Non-fatal recoverable errors collected while producing an otherwise successful response.',
    items: ref('JsonApiErrorObject'),
  },
  WarningsMeta: {
    type: 'object',
    properties: { warnings: ref('Warnings') },
  },
  CollectionMeta: {
    type: 'object',
    properties: {
      page: {
        type: 'object',
        description: 'Aggregate counts; present when the backend reports a total.',
        properties: { total: { type: 'integer' } },
      },
      warnings: ref('Warnings'),
    },
  },
  PaginationLinks: {
    type: 'object',
    required: ['self'],
    properties: {
      self: { type: 'string' },
      first: { type: 'string' },
      last: { type: 'string' },
      prev: { type: 'string' },
      next: { type: 'string' },
    },
  },
  ResourceLinks: {
    type: 'object',
    properties: { self: { type: 'string' } },
  },
  StorageObjectMetadata: {
    type: 'object',
    description: 'Capability-driven object metadata (file extension, backend revision id, backend-specific extras).',
    properties: {
      extension: { type: 'string' },
      revisionId: { type: 'string' },
    },
    additionalProperties: true,
  },
  StorageObjectAttributes: {
    type: 'object',
    required: ['type', 'content'],
    properties: {
      type: { const: 'object' },
      content: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
  StorageObjectResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'object' },
      id: { type: 'string', description: 'The storage key.' },
      attributes: ref('StorageObjectAttributes'),
      meta: ref('StorageObjectMetadata'),
      links: ref('ResourceLinks'),
    },
  },
  FolderAttributes: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { const: 'folder' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
  FolderResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'folder' },
      id: { type: 'string', description: 'The folder key.' },
      attributes: ref('FolderAttributes'),
      links: ref('ResourceLinks'),
    },
  },
  StorageObjectSummaryResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'object-summary' },
      id: { type: 'string', description: 'The storage key.' },
      attributes: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { const: 'object-summary' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
      links: ref('ResourceLinks'),
    },
  },
  FolderSummaryResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'folder-summary' },
      id: { type: 'string', description: 'The folder key.' },
      attributes: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { const: 'folder-summary' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
      links: ref('ResourceLinks'),
    },
  },
  AtomResource: {
    oneOf: [ref('StorageObjectResource'), ref('FolderResource')],
  },
  AtomSummaryResource: {
    oneOf: [ref('StorageObjectSummaryResource'), ref('FolderSummaryResource')],
  },
  UnsupportedCapability: {
    type: 'object',
    required: ['supported', 'description'],
    properties: {
      supported: { const: false },
      description: { type: 'string' },
    },
  },
  Capabilities: {
    type: 'object',
    required: ['compatibilityDate', 'fileExtensions', 'pagination'],
    properties: {
      compatibilityDate: { type: 'string' },
      fileExtensions: {
        oneOf: [
          ref('UnsupportedCapability'),
          {
            type: 'object',
            required: ['supported', 'description', 'supportedExtensions'],
            properties: {
              supported: { const: true },
              description: { type: 'string' },
              supportedExtensions: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  required: ['format'],
                  properties: { format: { type: 'string' } },
                },
              },
            },
          },
        ],
      },
      pagination: {
        oneOf: [
          ref('UnsupportedCapability'),
          {
            type: 'object',
            required: ['supported', 'description', 'styles'],
            properties: {
              supported: { const: true },
              description: { type: 'string' },
              styles: {
                type: 'object',
                required: ['offset', 'page', 'cursor'],
                properties: {
                  offset: { type: 'boolean' },
                  page: { type: 'boolean' },
                  cursor: { type: 'boolean' },
                },
              },
            },
          },
        ],
      },
    },
  },
  CapabilitiesResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'storage-capabilities' },
      id: { const: 'self' },
      attributes: ref('Capabilities'),
      links: ref('ResourceLinks'),
    },
  },
  ApiInfoResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'api-info' },
      id: { const: 'storage' },
      attributes: {
        type: 'object',
        required: ['name', 'version', 'endpoints'],
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          endpoints: {
            type: 'array',
            items: {
              type: 'object',
              required: ['path', 'methods', 'description'],
              properties: {
                path: { type: 'string' },
                methods: { type: 'array', items: { type: 'string' } },
                description: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  ApiInfoResponse: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('ApiInfoResource') },
  },
  CapabilitiesResponse: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('CapabilitiesResource') },
  },
  StorageObjectResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('StorageObjectResource'),
      meta: ref('WarningsMeta'),
    },
  },
  FolderResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('FolderResource'),
      meta: ref('WarningsMeta'),
    },
  },
  AtomCollectionResponse: {
    type: 'object',
    required: ['data', 'links'],
    properties: {
      data: { type: 'array', items: ref('AtomResource') },
      links: ref('PaginationLinks'),
      meta: ref('CollectionMeta'),
    },
  },
  AtomSummaryCollectionResponse: {
    type: 'object',
    required: ['data', 'links'],
    properties: {
      data: { type: 'array', items: ref('AtomSummaryResource') },
      links: ref('PaginationLinks'),
      meta: ref('CollectionMeta'),
    },
  },
  ObjectDeletedResponse: {
    type: 'object',
    required: ['meta'],
    properties: {
      meta: {
        type: 'object',
        required: ['deleted'],
        properties: {
          deleted: { const: true },
          warnings: ref('Warnings'),
        },
      },
    },
  },
  StorageObjectCreateData: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'object' },
      id: { type: 'string', description: 'The storage key. Must be non-empty.' },
      attributes: {
        type: 'object',
        description: 'Only "type" and "content" are accepted; any other key is rejected with 400.',
        properties: {
          type: { const: 'object' },
          content: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
      meta: ref('StorageObjectMetadata'),
    },
  },
  StorageObjectUpdateData: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'object' },
      id: { type: 'string', description: 'The storage key. Must match the key in the URL.' },
      attributes: {
        type: 'object',
        description: 'Only "type" and "content" are accepted; any other key is rejected with 400.',
        properties: {
          type: { const: 'object' },
          content: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
      meta: ref('StorageObjectMetadata'),
    },
  },
  FolderCreateData: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'folder' },
      id: { type: 'string', description: 'The folder key. Must be non-empty.' },
      attributes: {
        type: 'object',
        properties: { type: { const: 'folder' } },
      },
    },
  },
  StorageObjectCreateRequest: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('StorageObjectCreateData') },
  },
  StorageObjectUpdateRequest: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('StorageObjectUpdateData') },
  },
  FolderCreateRequest: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('FolderCreateData') },
  },
  AtomicAddOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'add' },
      data: { oneOf: [ref('StorageObjectCreateData'), ref('FolderCreateData')] },
    },
  },
  AtomicUpdateOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'update' },
      data: ref('StorageObjectUpdateData'),
    },
  },
  AtomicRemoveOperation: {
    type: 'object',
    required: ['op', 'ref'],
    properties: {
      op: { const: 'remove' },
      ref: {
        type: 'object',
        required: ['type', 'id'],
        properties: {
          type: { enum: ['object', 'folder', 'atom'] },
          id: { type: 'string' },
        },
      },
    },
  },
  AtomicOperationsRequest: {
    type: 'object',
    required: ['atomic:operations'],
    properties: {
      'atomic:operations': {
        type: 'array',
        items: {
          oneOf: [ref('AtomicAddOperation'), ref('AtomicUpdateOperation'), ref('AtomicRemoveOperation')],
        },
      },
    },
  },
  AtomicChangeResult: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('AtomResource'),
      meta: ref('WarningsMeta'),
    },
  },
  AtomicRemoveResult: {
    type: 'object',
    required: ['meta'],
    properties: {
      meta: {
        type: 'object',
        required: ['deleted', 'ref'],
        properties: {
          deleted: { const: true },
          ref: {
            type: 'object',
            required: ['type', 'id'],
            properties: {
              type: { type: 'string' },
              id: { type: 'string' },
            },
          },
        },
      },
    },
  },
  AtomicResultsResponse: {
    type: 'object',
    description: 'One entry per successful operation, in operation order. Failed operations are omitted.',
    required: ['atomic:results'],
    properties: {
      'atomic:results': {
        type: 'array',
        items: { oneOf: [ref('AtomicChangeResult'), ref('AtomicRemoveResult')] },
      },
    },
  },
};

const paths: Record<string, OpenApiPathItem> = {
  '/': {
    get: {
      operationId: 'getApiInfo',
      summary: 'API info and endpoint discovery',
      tags: ['info'],
      responses: {
        '200': jsonApiResponse('API info resource listing the available endpoints.', 'ApiInfoResponse'),
      },
    },
  },
  '/openapi.json': {
    get: {
      operationId: 'getOpenApiDocument',
      summary: 'This OpenAPI 3.1 document',
      tags: ['info'],
      responses: {
        '200': {
          description: 'The OpenAPI 3.1 document describing this API, with servers rewritten to the request origin.',
          content: {
            'application/json': {
              schema: { type: 'object', description: 'An OpenAPI 3.1 document.' },
            },
          },
        },
      },
    },
  },
  '/capabilities': {
    get: {
      operationId: 'getCapabilities',
      summary: 'Underlying storage repository capabilities',
      description: 'Resolved from the repository on every request, so a swapped-out backend is reflected immediately.',
      tags: ['capabilities'],
      responses: {
        '200': jsonApiResponse('The storage-capabilities resource.', 'CapabilitiesResponse'),
        default: mappedRepositoryError,
      },
    },
  },
  '/atoms': {
    get: listAtomsOperation('listRootAtoms', 'List atoms in the root folder', false),
    post: {
      operationId: 'createFolder',
      summary: 'Create a folder',
      tags: ['atoms', 'folders'],
      requestBody: jsonApiRequestBody('JSON:API folder resource to create.', 'FolderCreateRequest'),
      responses: {
        '201': jsonApiResponse('The created folder resource.', 'FolderResponse'),
        '400': errorResponse('Invalid request body, or data.id is empty.'),
        default: mappedRepositoryError,
      },
    },
  },
  '/atoms/{key}': {
    parameters: [keyPathParameter('Key of the folder to list.')],
    get: listAtomsOperation('listAtoms', 'List atoms in a folder', true),
  },
  '/atom-summaries': {
    get: listAtomSummariesOperation(
      'listRootAtomSummaries',
      'List atom summaries (lightweight listing) in the root folder',
      false,
    ),
  },
  '/atom-summaries/{key}': {
    parameters: [keyPathParameter('Key of the folder to list.')],
    get: listAtomSummariesOperation('listAtomSummaries', 'List atom summaries (lightweight listing) in a folder', true),
  },
  '/objects': {
    post: {
      operationId: 'createStorageObject',
      summary: 'Create a storage object',
      tags: ['objects'],
      requestBody: jsonApiRequestBody('JSON:API storage object resource to create.', 'StorageObjectCreateRequest'),
      responses: {
        '201': jsonApiResponse('The created storage object, possibly with meta.warnings.', 'StorageObjectResponse'),
        '400': errorResponse('Invalid request body, unknown attribute key, or empty data.id.'),
        default: mappedRepositoryError,
      },
    },
  },
  '/objects/{key}': {
    description: 'Methods other than GET, PATCH and DELETE are answered with 405 Method Not Allowed '
      + 'and an Allow header.',
    parameters: [keyPathParameter('Key of the storage object.')],
    get: {
      operationId: 'getStorageObject',
      summary: 'Read a storage object',
      tags: ['objects'],
      responses: {
        '200': jsonApiResponse('The storage object, possibly with meta.warnings.', 'StorageObjectResponse'),
        '404': errorResponse('Object not found.'),
        default: mappedRepositoryError,
      },
    },
    patch: {
      operationId: 'updateStorageObject',
      summary: 'Update a storage object',
      tags: ['objects'],
      requestBody: jsonApiRequestBody(
        'JSON:API storage object resource; data.id must match the key in the URL.',
        'StorageObjectUpdateRequest',
      ),
      responses: {
        '200': jsonApiResponse('The updated storage object, possibly with meta.warnings.', 'StorageObjectResponse'),
        '400': errorResponse('Invalid request body, unknown attribute key, or URL key does not match body data.id.'),
        '404': errorResponse('Object not found.'),
        default: mappedRepositoryError,
      },
    },
    delete: {
      operationId: 'deleteStorageObject',
      summary: 'Delete a storage object',
      tags: ['objects'],
      responses: {
        '200': jsonApiResponse('Deletion confirmation, possibly with meta.warnings.', 'ObjectDeletedResponse'),
        '404': errorResponse('Object not found (nothing was removed).'),
        default: mappedRepositoryError,
      },
    },
  },
  '/folders/{key}': {
    parameters: [keyPathParameter('Key of the folder.')],
    get: {
      operationId: 'getFolder',
      summary: 'Read a folder',
      tags: ['folders'],
      responses: {
        '200': jsonApiResponse('The folder resource, possibly with meta.warnings.', 'FolderResponse'),
        '404': errorResponse('Folder not found.'),
        default: mappedRepositoryError,
      },
    },
  },
  '/operations': {
    post: {
      operationId: 'runAtomicOperations',
      summary: 'Atomic operations (add, update, remove)',
      description: 'JSON:API atomic operations extension. Removes are batched through a single repository call; '
        + 'per-operation failures are omitted from atomic:results rather than failing the whole request.',
      tags: ['operations'],
      requestBody: jsonApiRequestBody('Atomic operations to apply.', 'AtomicOperationsRequest'),
      responses: {
        '200': jsonApiResponse('Results for the successful operations.', 'AtomicResultsResponse'),
        '400': errorResponse('Invalid atomic operations request, or an unknown attribute key in an add/update.'),
        default: mappedRepositoryError,
      },
    },
  },
};

export interface StorageOpenApiOptions {
  basePath?: string | undefined;
}

/**
 * Build the OpenAPI 3.1 document describing the storage JSON:API handler
 * produced by `buildJsonApi`. Path keys are relative to `basePath`,
 * which only feeds the `servers` entry (the served /openapi.json route
 * rewrites it to the absolute request origin).
 */
export function buildStorageOpenApi(options: StorageOpenApiOptions = {}): OpenApiDocument {
  const { basePath = '' } = options;
  return {
    openapi: '3.1.0',
    info: {
      title: 'Laika CMS Storage API',
      version: '1.0.1',
      description: 'JSON:API-style HTTP interface over a Laika CMS StorageRepository: storage objects, folders, '
        + 'atom listings, capabilities introspection, and JSON:API atomic operations. Successful responses may carry '
        + 'a meta.warnings array of non-fatal recoverable errors alongside the requested data. '
        + '⚠️ The handler ships no authentication — wrap it before exposing it to an untrusted network.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: basePath || '/' }],
    tags: [
      { name: 'info', description: 'API metadata and discovery' },
      { name: 'capabilities', description: 'Backend capability introspection' },
      { name: 'atoms', description: 'Folder listings over objects and folders (atoms)' },
      { name: 'objects', description: 'Storage object CRUD' },
      { name: 'folders', description: 'Folder resources' },
      { name: 'operations', description: 'JSON:API atomic operations extension' },
    ],
    paths,
    components: { schemas },
  };
}
