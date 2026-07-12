import type { OpenApiDocument, OpenApiParameter, OpenApiResponse, OpenApiSchema } from 'laikacms/json-api';

const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';

const ref = (name: string): OpenApiSchema => ({ $ref: `#/components/schemas/${name}` });

const jsonApiContent = (schema: OpenApiSchema) => ({ [JSON_API_MEDIA_TYPE]: { schema } });

const errorResponse = (description: string): OpenApiResponse => ({
  description,
  content: jsonApiContent(ref('JsonApiError')),
});

const keyParameter: OpenApiParameter = {
  name: 'key',
  in: 'path',
  required: true,
  description: 'Document key (URL-encoded; keys may contain `/`, encoded as `%2F`).',
  schema: { type: 'string', maxLength: 1023 },
};

const revisionIdParameter: OpenApiParameter = {
  name: 'revisionId',
  in: 'path',
  required: true,
  description: 'Revision identifier for the document.',
  schema: { type: 'string' },
};

const paginationParameters: OpenApiParameter[] = [
  {
    name: 'page[number]',
    in: 'query',
    description: 'Page number for page-based pagination (1-based). Defaults to 1 when no pagination key is present.',
    schema: { type: 'integer', minimum: 1 },
  },
  {
    name: 'page[size]',
    in: 'query',
    description: 'Items per page — combines with page[number], page[after], or page[before]. Defaults to 10.',
    schema: { type: 'integer', minimum: 1 },
  },
  {
    name: 'page[offset]',
    in: 'query',
    description: 'Zero-based item offset for offset-based pagination.',
    schema: { type: 'integer', minimum: 0 },
  },
  {
    name: 'page[limit]',
    in: 'query',
    description: 'Maximum number of items to return — combines with page[offset].',
    schema: { type: 'integer', minimum: 1 },
  },
  {
    name: 'page[after]',
    in: 'query',
    description: 'Forward cursor. Rejected with 400 when the backend capabilities do not include cursor pagination '
      + '(consult GET /capabilities).',
    schema: { type: 'string' },
  },
  {
    name: 'page[before]',
    in: 'query',
    description: 'Backward cursor. Rejected with 400 when the backend capabilities do not include cursor pagination '
      + '(consult GET /capabilities).',
    schema: { type: 'string' },
  },
];

const recordsFilterParameters: OpenApiParameter[] = [
  {
    name: 'filter[type]',
    in: 'query',
    description: 'Which record variants to list. `all` lists both published and unpublished. Defaults to `published`.',
    schema: { type: 'string', enum: ['published', 'unpublished', 'all'] },
  },
  {
    name: 'filter[folder]',
    in: 'query',
    description: 'Folder (collection name) to list. Defaults to the empty string; backends may require it.',
    schema: { type: 'string' },
  },
  {
    name: 'filter[depth]',
    in: 'query',
    description: 'Folder recursion depth. Defaults to 1.',
    schema: { type: 'integer', minimum: 1 },
  },
];

const resourceAttributes = (
  typeName: string,
  extra: Record<string, OpenApiSchema>,
  required: string[],
): OpenApiSchema => ({
  type: 'object',
  required: ['type', ...required],
  properties: {
    type: { const: typeName },
    language: {
      type: 'string',
      description: 'BCP 47 language tag. Omitted when undetermined ("und").',
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    ...extra,
  },
});

const resource = (typeName: string, attributes: OpenApiSchema): OpenApiSchema => ({
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: typeName },
    id: { type: 'string', description: 'Document key.' },
    attributes,
    links: ref('ResourceLinks'),
  },
});

const schemas: Record<string, OpenApiSchema> = {
  JsonApiErrorObject: {
    type: 'object',
    required: ['code', 'status', 'title', 'detail'],
    properties: {
      code: { type: 'string', description: 'Machine-readable Laika error code, e.g. `not_found`, `invalid_data`.' },
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
    description: 'Recoverable errors collected while producing the response, in JSON:API error-object shape.',
    items: ref('JsonApiErrorObject'),
  },
  ResourceLinks: {
    type: 'object',
    properties: {
      self: { type: 'string', description: 'Canonical detail URL for this resource, relative to the server origin.' },
    },
    additionalProperties: { type: 'string' },
  },
  PaginationLinks: {
    type: 'object',
    properties: {
      self: { type: 'string' },
      first: { type: 'string' },
      last: { type: 'string' },
      prev: { type: 'string' },
      next: { type: 'string' },
    },
  },
  ResourceMeta: {
    type: 'object',
    properties: {
      warnings: ref('Warnings'),
    },
  },
  CollectionMeta: {
    type: 'object',
    properties: {
      page: {
        type: 'object',
        properties: {
          total: { type: 'integer', description: 'Total number of items across all pages, when the backend knows it.' },
        },
      },
      warnings: ref('Warnings'),
    },
  },
  DocumentContent: {
    type: 'object',
    description: 'Arbitrary document content.',
    additionalProperties: true,
  },
  PaginationCapability: {
    oneOf: [
      {
        type: 'object',
        required: ['supported', 'description'],
        properties: {
          supported: { const: false },
          description: { type: 'string' },
        },
      },
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
  PublishedResource: resource(
    'published',
    resourceAttributes('published', {
      status: { const: 'published' },
      content: ref('DocumentContent'),
    }, ['status', 'content']),
  ),
  PublishedSummaryResource: resource(
    'published-summary',
    resourceAttributes('published-summary', {
      status: { const: 'published' },
    }, ['status']),
  ),
  UnpublishedResource: resource(
    'unpublished',
    resourceAttributes('unpublished', {
      status: {
        type: 'string',
        description: 'Unpublished state, e.g. `draft`, `pending_review`, `archived`, `trash`.',
      },
      content: ref('DocumentContent'),
    }, ['status', 'content']),
  ),
  UnpublishedSummaryResource: resource(
    'unpublished-summary',
    resourceAttributes('unpublished-summary', {
      status: { type: 'string' },
    }, ['status']),
  ),
  RevisionResource: resource(
    'revision',
    resourceAttributes('revision', {
      revision: { type: 'string' },
      content: ref('DocumentContent'),
    }, ['revision', 'content', 'createdAt']),
  ),
  RevisionSummaryResource: resource(
    'revision-summary',
    resourceAttributes('revision-summary', {
      revision: { type: 'string' },
    }, ['revision']),
  ),
  CapabilitiesResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'documents-capabilities' },
      id: { const: 'self' },
      attributes: {
        type: 'object',
        required: ['compatibilityDate', 'pagination'],
        properties: {
          compatibilityDate: { type: 'string' },
          pagination: ref('PaginationCapability'),
        },
      },
      links: ref('ResourceLinks'),
    },
  },
  ApiInfoResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'api-info' },
      id: { const: 'documents' },
      attributes: {
        type: 'object',
        required: ['name', 'version', 'endpoints'],
        properties: {
          name: { const: 'Documents API' },
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
    properties: {
      data: ref('ApiInfoResource'),
    },
  },
  CapabilitiesResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('CapabilitiesResource'),
    },
  },
  PublishedResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('PublishedResource'),
      meta: ref('ResourceMeta'),
    },
  },
  UnpublishedResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('UnpublishedResource'),
      meta: ref('ResourceMeta'),
    },
  },
  RevisionResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('RevisionResource'),
      meta: ref('ResourceMeta'),
    },
  },
  RecordsCollectionResponse: {
    type: 'object',
    required: ['data', 'links'],
    properties: {
      data: {
        type: 'array',
        items: { oneOf: [ref('PublishedResource'), ref('UnpublishedResource')] },
      },
      links: ref('PaginationLinks'),
      meta: ref('CollectionMeta'),
    },
  },
  RecordSummariesCollectionResponse: {
    type: 'object',
    required: ['data', 'links'],
    properties: {
      data: {
        type: 'array',
        items: { oneOf: [ref('PublishedSummaryResource'), ref('UnpublishedSummaryResource')] },
      },
      links: ref('PaginationLinks'),
      meta: ref('CollectionMeta'),
    },
  },
  RevisionSummariesCollectionResponse: {
    type: 'object',
    required: ['data', 'links'],
    properties: {
      data: { type: 'array', items: ref('RevisionSummaryResource') },
      links: ref('PaginationLinks'),
      meta: ref('CollectionMeta'),
    },
  },
  DeletedResponse: {
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
  PublishedCreateRequest: {
    type: 'object',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: ['type', 'id', 'attributes'],
        properties: {
          type: { const: 'published' },
          id: { type: 'string', description: 'Document key.' },
          attributes: {
            type: 'object',
            description: 'Document attributes — typically `status`, `language`, and `content`.',
            additionalProperties: true,
          },
        },
      },
    },
  },
  UnpublishedCreateRequest: {
    type: 'object',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: ['type', 'id', 'attributes'],
        properties: {
          type: { const: 'unpublished' },
          id: { type: 'string', description: 'Document key.' },
          attributes: {
            type: 'object',
            description: 'Draft attributes — typically `status`, `language`, and `content`.',
            additionalProperties: true,
          },
        },
      },
    },
  },
  UnpublishedUpdateRequest: {
    type: 'object',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: ['type', 'id', 'attributes'],
        properties: {
          type: { const: 'unpublished' },
          id: { type: 'string', description: 'Document key.' },
          attributes: {
            type: 'object',
            description: 'Fields to update — `content`, `status`, and/or `language`.',
            additionalProperties: true,
          },
        },
      },
    },
  },
  UnpublishRequest: {
    type: 'object',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: ['type', 'attributes'],
        properties: {
          type: { const: 'unpublished' },
          attributes: {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', description: 'Unpublished state to transition the document into.' },
            },
          },
        },
      },
    },
  },
  RevisionCreateRequest: {
    type: 'object',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: ['type', 'id', 'attributes'],
        properties: {
          type: { const: 'revision' },
          id: { type: 'string', description: 'Document key the revision belongs to.' },
          attributes: {
            type: 'object',
            description: 'Revision attributes — typically `revision`, `language`, and `content`.',
            additionalProperties: true,
          },
        },
      },
    },
  },
  ResourceRef: {
    type: 'object',
    required: ['id', 'type'],
    properties: {
      id: { type: 'string', description: 'Document key.' },
      type: { type: 'string', enum: ['document', 'unpublished', 'revision'] },
    },
  },
  AddPublishedOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'add' },
      data: {
        type: 'object',
        required: ['type', 'id', 'attributes'],
        properties: {
          type: { const: 'published' },
          id: { type: 'string' },
          attributes: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  AddUnpublishedOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'add' },
      data: {
        type: 'object',
        required: ['type', 'id', 'attributes'],
        properties: {
          type: { const: 'unpublished' },
          id: { type: 'string' },
          attributes: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  StateTransitionOperation: {
    type: 'object',
    required: ['op', 'href', 'ref'],
    properties: {
      op: { const: 'update' },
      href: {
        type: 'string',
        enum: ['/publish', '/unpublish'],
        description: '`/publish` requires ref.type `unpublished`; `/unpublish` requires ref.type `document` '
          + 'plus a `data` member carrying the target status.',
      },
      ref: ref('ResourceRef'),
      data: {
        type: 'object',
        required: ['type', 'attributes'],
        properties: {
          type: { const: 'unpublished' },
          attributes: {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string' },
            },
          },
        },
      },
    },
  },
  UpdateUnpublishedOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'update' },
      data: {
        type: 'object',
        required: ['type', 'id', 'attributes'],
        properties: {
          type: { const: 'unpublished' },
          id: { type: 'string' },
          attributes: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  RemoveOperation: {
    type: 'object',
    required: ['op', 'ref'],
    properties: {
      op: { const: 'remove' },
      ref: ref('ResourceRef'),
    },
  },
  BatchOperationsRequest: {
    type: 'object',
    required: ['operations'],
    properties: {
      operations: {
        type: 'array',
        items: {
          oneOf: [
            ref('AddPublishedOperation'),
            ref('AddUnpublishedOperation'),
            ref('StateTransitionOperation'),
            ref('UpdateUnpublishedOperation'),
            ref('RemoveOperation'),
          ],
        },
      },
    },
  },
  AtomicResultError: {
    type: 'object',
    required: ['status', 'title'],
    properties: {
      status: { type: 'string' },
      title: { type: 'string' },
      detail: { type: 'string' },
    },
  },
  AtomicResult: {
    oneOf: [
      {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            oneOf: [ref('PublishedResource'), ref('UnpublishedResource'), { type: 'null' }],
          },
          meta: ref('ResourceMeta'),
        },
      },
      {
        type: 'object',
        required: ['meta'],
        properties: {
          meta: {
            type: 'object',
            required: ['deleted', 'ref'],
            properties: {
              deleted: { const: true },
              ref: ref('ResourceRef'),
              warnings: ref('Warnings'),
            },
          },
        },
      },
      {
        type: 'object',
        required: ['errors'],
        properties: {
          errors: { type: 'array', items: ref('AtomicResultError') },
        },
      },
    ],
  },
  BatchOperationsResponse: {
    type: 'object',
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        description: 'One entry per applied operation, in request order. Processing stops at the first '
          + 'repository failure — subsequent operations are not applied. A failing operation produces an '
          + '`errors` entry; preceding ops that succeeded remain applied (fail-fast batch, not a transaction).',
        items: ref('AtomicResult'),
      },
    },
  },
};

/**
 * Build the OpenAPI 3.1 document describing {@link buildJsonApi}'s routes.
 * `basePath` must match the one the server was built with; path keys are
 * relative to it. The server route `GET {basePath}/openapi.json` serves this
 * document with `servers[0].url` rewritten to the request origin.
 */
export function buildDocumentsOpenApi(options: { basePath?: string } = {}): OpenApiDocument {
  const { basePath = '' } = options;

  return {
    openapi: '3.1.0',
    info: {
      title: 'Laika CMS Documents API',
      version: '1.0.1',
      license: { name: 'MIT', identifier: 'MIT' },
      description: 'JSON:API-style HTTP interface over a Laika CMS documents repository: published documents, '
        + 'unpublished drafts, revisions, publish/unpublish state transitions, and fail-fast operation batches. '
        + 'Success responses use the `application/vnd.api+json` media type. '
        + 'Warning: this API ships no built-in authentication — wrap it with middleware that validates '
        + 'credentials before exposing it to an untrusted network, otherwise anyone who can reach it can read, '
        + 'create, modify, publish, unpublish, and delete documents and revisions.',
    },
    servers: [{ url: basePath === '' ? '/' : basePath }],
    tags: [
      { name: 'info', description: 'API self-description.' },
      { name: 'capabilities', description: 'Backend capability introspection.' },
      { name: 'records', description: 'Combined published + unpublished listings.' },
      { name: 'published', description: 'Published documents.' },
      { name: 'unpublished', description: 'Unpublished drafts.' },
      { name: 'revisions', description: 'Document revisions.' },
      { name: 'operations', description: 'Fail-fast batch operations.' },
    ],
    paths: {
      '/': {
        get: {
          operationId: 'getApiInfo',
          summary: 'List available endpoints',
          tags: ['info'],
          responses: {
            '200': {
              description: 'API info resource enumerating the available endpoints.',
              content: jsonApiContent(ref('ApiInfoResponse')),
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          operationId: 'getOpenApiDocument',
          summary: 'Get this OpenAPI 3.1 document',
          tags: ['info'],
          responses: {
            '200': {
              description: 'The OpenAPI document, with `servers[0].url` resolved against the request origin.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/capabilities': {
        get: {
          operationId: 'getCapabilities',
          summary: 'Get the underlying documents repository capabilities',
          tags: ['capabilities'],
          responses: {
            '200': {
              description: 'Capabilities of the backing documents repository.',
              content: jsonApiContent(ref('CapabilitiesResponse')),
            },
            '400': errorResponse('Repository failure mapped from its error code.'),
            '404': errorResponse('Capabilities unavailable.'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/records': {
        get: {
          operationId: 'listRecords',
          summary: 'List full records (published and/or unpublished view per key)',
          tags: ['records'],
          parameters: [...recordsFilterParameters, ...paginationParameters],
          responses: {
            '200': {
              description: 'Record collection with pagination links, `meta.page.total` when the backend reports '
                + 'a total, and `meta.warnings` for per-item recoverable errors.',
              content: jsonApiContent(ref('RecordsCollectionResponse')),
            },
            '400': errorResponse(
              'Invalid filter/pagination parameters, cursor pagination requested but unsupported by the backend, '
                + 'or a bad-request repository failure.',
            ),
            '404': errorResponse('Repository reported not-found (e.g. unknown collection).'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/record-summaries': {
        get: {
          operationId: 'listRecordSummaries',
          summary: 'List record summaries (lightweight listing without content)',
          tags: ['records'],
          parameters: [...recordsFilterParameters, ...paginationParameters],
          responses: {
            '200': {
              description: 'Record summary collection with pagination links and meta.',
              content: jsonApiContent(ref('RecordSummariesCollectionResponse')),
            },
            '400': errorResponse(
              'Invalid filter/pagination parameters, cursor pagination requested but unsupported by the backend, '
                + 'or a bad-request repository failure.',
            ),
            '404': errorResponse('Repository reported not-found (e.g. unknown collection).'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/published': {
        post: {
          operationId: 'createPublished',
          summary: 'Create a published document',
          tags: ['published'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('PublishedCreateRequest')),
          },
          responses: {
            '201': {
              description: 'Created published document; `meta.warnings` carries recoverable write warnings.',
              content: jsonApiContent(ref('PublishedResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, or repository failure.'),
            '404': errorResponse('Repository reported not-found.'),
          },
        },
      },
      '/published/{key}': {
        parameters: [keyParameter],
        get: {
          operationId: 'getPublished',
          summary: 'Read a published document',
          tags: ['published'],
          responses: {
            '200': {
              description: 'The published document.',
              content: jsonApiContent(ref('PublishedResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '404': errorResponse('Document not found.'),
          },
        },
        patch: {
          operationId: 'updatePublished',
          summary: 'Update a published document',
          tags: ['published'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('PublishedCreateRequest')),
          },
          responses: {
            '200': {
              description: 'The updated published document.',
              content: jsonApiContent(ref('PublishedResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, or repository failure.'),
            '404': errorResponse('Document not found.'),
          },
        },
        delete: {
          operationId: 'deletePublished',
          summary: 'Remove a published document',
          tags: ['published'],
          responses: {
            '200': {
              description: 'Deletion confirmation; `meta.warnings` carries recoverable cleanup warnings.',
              content: jsonApiContent(ref('DeletedResponse')),
            },
            '400': errorResponse(
              'Repository failure (including not-found — the error object carries the underlying status).',
            ),
          },
        },
      },
      '/published/{key}/unpublish': {
        parameters: [keyParameter],
        post: {
          operationId: 'unpublishPublished',
          summary: 'State transition: move a published document to unpublished',
          tags: ['published'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('UnpublishRequest')),
          },
          responses: {
            '200': {
              description: 'The resulting unpublished document.',
              content: jsonApiContent(ref('UnpublishedResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, or repository failure.'),
            '404': errorResponse('Published document not found.'),
          },
        },
      },
      '/unpublished': {
        post: {
          operationId: 'createUnpublished',
          summary: 'Create an unpublished draft',
          tags: ['unpublished'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('UnpublishedCreateRequest')),
          },
          responses: {
            '201': {
              description: 'Created unpublished draft.',
              content: jsonApiContent(ref('UnpublishedResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, or repository failure.'),
            '404': errorResponse('Repository reported not-found.'),
          },
        },
      },
      '/unpublished/{key}': {
        parameters: [keyParameter],
        get: {
          operationId: 'getUnpublished',
          summary: 'Read an unpublished draft',
          tags: ['unpublished'],
          responses: {
            '200': {
              description: 'The unpublished draft.',
              content: jsonApiContent(ref('UnpublishedResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '404': errorResponse('Draft not found.'),
          },
        },
        patch: {
          operationId: 'updateUnpublished',
          summary: 'Update an unpublished draft',
          tags: ['unpublished'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('UnpublishedUpdateRequest')),
          },
          responses: {
            '200': {
              description: 'The updated unpublished draft.',
              content: jsonApiContent(ref('UnpublishedResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, or repository failure.'),
            '404': errorResponse('Draft not found.'),
          },
        },
        delete: {
          operationId: 'deleteUnpublished',
          summary: 'Remove an unpublished draft',
          tags: ['unpublished'],
          responses: {
            '200': {
              description: 'Deletion confirmation; `meta.warnings` carries recoverable cleanup warnings.',
              content: jsonApiContent(ref('DeletedResponse')),
            },
            '400': errorResponse(
              'Repository failure (including not-found — the error object carries the underlying status).',
            ),
          },
        },
      },
      '/unpublished/{key}/publish': {
        parameters: [keyParameter],
        post: {
          operationId: 'publishUnpublished',
          summary: 'State transition: publish an unpublished draft',
          tags: ['unpublished'],
          responses: {
            '200': {
              description: 'The resulting published document.',
              content: jsonApiContent(ref('PublishedResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '404': errorResponse('Draft not found.'),
          },
        },
      },
      '/revisions': {
        post: {
          operationId: 'createRevision',
          summary: 'Create a revision for a document',
          tags: ['revisions'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('RevisionCreateRequest')),
          },
          responses: {
            '201': {
              description: 'Created revision.',
              content: jsonApiContent(ref('RevisionResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, or repository failure.'),
            '404': errorResponse('Repository reported not-found.'),
          },
        },
      },
      '/revisions/{key}': {
        parameters: [keyParameter],
        get: {
          operationId: 'listRevisions',
          summary: 'List revisions for a document',
          tags: ['revisions'],
          parameters: [...paginationParameters],
          responses: {
            '200': {
              description: 'Revision summary collection with pagination links and meta.',
              content: jsonApiContent(ref('RevisionSummariesCollectionResponse')),
            },
            '400': errorResponse(
              'Invalid pagination parameters, cursor pagination requested but unsupported by the backend, '
                + 'or a bad-request repository failure.',
            ),
            '404': errorResponse('Document not found.'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/revisions/{key}/{revisionId}': {
        parameters: [keyParameter, revisionIdParameter],
        get: {
          operationId: 'getRevision',
          summary: 'Read a specific revision of a document',
          tags: ['revisions'],
          responses: {
            '200': {
              description: 'The revision.',
              content: jsonApiContent(ref('RevisionResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '404': errorResponse('Revision not found.'),
          },
        },
      },
      '/operations': {
        post: {
          operationId: 'postBatchOperations',
          summary: 'Batch operations (add/update/remove and publish/unpublish transitions)',
          description: 'Fail-fast batch: all operations are validated for request shape before any I/O. '
            + 'A shape-invalid op (e.g. missing `data.id` on an add) returns HTTP 400 with zero writes. '
            + 'Once validation passes, ops are applied sequentially; the first repository failure stops '
            + 'processing and no subsequent ops run. '
            + 'A mid-batch repository failure leaves previously-applied ops applied — '
            + 'this endpoint is a fail-fast batch, not a transaction.',
          tags: ['operations'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('BatchOperationsRequest')),
          },
          responses: {
            '200': {
              description: 'Results for all applied operations. Processing stopped if a repository failure occurred.',
              content: jsonApiContent(ref('BatchOperationsResponse')),
            },
            '400': errorResponse(
              'Shape-invalid batch (missing required field, wrong type) — zero writes performed; '
                + 'or malformed JSON / schema-invalid body.',
            ),
          },
        },
      },
    },
    components: { schemas },
  };
}
