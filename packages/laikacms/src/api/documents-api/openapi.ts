import type { OpenApiDocument, OpenApiParameter, OpenApiResponse, OpenApiSchema } from 'laikacms/json-api';
import {
  apiInfoComponents,
  capabilityComponents,
  compactOpenApiDocument,
  jsonApiContent,
  jsonApiErrorComponents,
  jsonApiErrorResponseComponents,
  jsonApiLinkComponents,
  paginationParameters,
  schemaRef as ref,
} from 'laikacms/json-api';

/** `parsePaginationQuery` falls back to page 1 × 10 items for this API. */
const DEFAULT_PAGE_SIZE = 10;

// Authored inline so every operation keeps its own wording; the document is run
// through `compactOpenApiDocument` on the way out, which folds each occurrence
// into a `$ref` against the `ErrorResponse` component.
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

const listParameters = [...recordsFilterParameters, ...paginationParameters({ defaultPageSize: DEFAULT_PAGE_SIZE })];

/**
 * Attributes for one resource variant: the timestamps and language every
 * record carries, composed with the variant's own discriminator and fields.
 */
const resourceAttributes = (
  typeName: string,
  extra: Record<string, OpenApiSchema>,
  required: string[],
): OpenApiSchema => ({
  allOf: [
    ref('RecordTimestamps'),
    {
      type: 'object',
      required: ['type', ...required],
      properties: {
        type: { const: typeName },
        ...extra,
      },
    },
  ],
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

/**
 * The `{type, id, attributes}` payload a write carries. Shared by the
 * single-resource request bodies and by the equivalent batch operations, which
 * accept exactly the same data member.
 */
const writeData = (typeName: string, attributesDescription: string): OpenApiSchema => ({
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: typeName },
    id: { type: 'string', description: 'Document key.' },
    attributes: {
      type: 'object',
      description: attributesDescription,
      additionalProperties: true,
    },
  },
});

/** A JSON:API request document wrapping one write payload. */
const writeRequest = (dataSchemaName: string): OpenApiSchema => ({
  type: 'object',
  required: ['data'],
  properties: { data: ref(dataSchemaName) },
});

/** A JSON:API response document wrapping one resource, plus warnings meta. */
const resourceResponse = (resourceSchemaName: string): OpenApiSchema => ({
  type: 'object',
  required: ['data'],
  properties: {
    data: ref(resourceSchemaName),
    meta: ref('WarningsMeta'),
  },
});

/** A paginated collection of `items`, with links and collection meta. */
const collectionResponse = (items: OpenApiSchema): OpenApiSchema => ({
  type: 'object',
  required: ['data', 'links'],
  properties: {
    data: { type: 'array', items },
    links: ref('PaginationLinks'),
    meta: ref('CollectionMeta'),
  },
});

const schemas: Record<string, OpenApiSchema> = {
  ...jsonApiErrorComponents(),
  ...jsonApiLinkComponents(),
  ...capabilityComponents({ versionTracking: true }),
  ...apiInfoComponents('documents'),

  ChangesMeta: {
    allOf: [
      ref('CollectionMeta'),
      {
        type: 'object',
        properties: {
          syncToken: {
            type: 'string',
            description: 'On change-feed responses: the new sync token to resume from.',
          },
        },
      },
    ],
  },
  RecordTimestamps: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'BCP 47 language tag. Omitted when undetermined ("und").',
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  DocumentContent: {
    type: 'object',
    description: 'Arbitrary document content.',
    additionalProperties: true,
  },
  SyncTokenResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'sync-token' },
      id: { type: 'string', description: 'The folder scope, or "self" for the whole store.' },
      attributes: {
        type: 'object',
        required: ['syncToken'],
        properties: {
          syncToken: {
            type: 'string',
            description: 'Opaque per-scope change token; compare only by equality.',
          },
          folder: { type: 'string', description: 'Folder scope, when the token was scoped.' },
        },
      },
      links: ref('ResourceLinks'),
    },
  },
  SyncTokenResponse: resourceResponse('SyncTokenResource'),
  ChangeSummaryResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'change-summary' },
      id: { type: 'string', description: 'The key that changed.' },
      attributes: {
        type: 'object',
        required: ['deleted'],
        properties: {
          deleted: { type: 'boolean', description: 'True when the record was removed from the scope.' },
          version: {
            type: 'string',
            description: 'Opaque per-record version token after the change. Omitted for deletions and on backends '
              + 'without version tracking.',
          },
        },
      },
    },
  },
  ChangesCollectionResponse: {
    type: 'object',
    required: ['data', 'links'],
    properties: {
      data: { type: 'array', items: ref('ChangeSummaryResource') },
      links: ref('PaginationLinks'),
      meta: ref('ChangesMeta'),
    },
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
        required: ['compatibilityDate', 'pagination', 'versionTracking', 'changes'],
        properties: {
          compatibilityDate: { type: 'string' },
          pagination: ref('PaginationCapability'),
          versionTracking: ref('VersionTrackingCapability'),
          changes: ref('ChangesCapability'),
        },
      },
      links: ref('ResourceLinks'),
    },
  },
  CapabilitiesResponse: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('CapabilitiesResource') },
  },
  PublishedResponse: resourceResponse('PublishedResource'),
  UnpublishedResponse: resourceResponse('UnpublishedResource'),
  RevisionResponse: resourceResponse('RevisionResource'),
  RecordsCollectionResponse: collectionResponse({
    oneOf: [ref('PublishedResource'), ref('UnpublishedResource')],
  }),
  RecordSummariesCollectionResponse: collectionResponse({
    oneOf: [ref('PublishedSummaryResource'), ref('UnpublishedSummaryResource')],
  }),
  RevisionSummariesCollectionResponse: collectionResponse(ref('RevisionSummaryResource')),
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
  PublishedWriteData: writeData(
    'published',
    'Document attributes — typically `status`, `language`, and `content`. Partial on update.',
  ),
  UnpublishedWriteData: writeData(
    'unpublished',
    'Draft attributes — typically `status`, `language`, and `content`. Partial on update.',
  ),
  RevisionWriteData: writeData(
    'revision',
    'Revision attributes — typically `revision`, `language`, and `content`.',
  ),
  PublishedCreateRequest: writeRequest('PublishedWriteData'),
  UnpublishedCreateRequest: writeRequest('UnpublishedWriteData'),
  UnpublishedUpdateRequest: writeRequest('UnpublishedWriteData'),
  RevisionCreateRequest: writeRequest('RevisionWriteData'),
  UnpublishTarget: {
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
  UnpublishRequest: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('UnpublishTarget') },
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
      data: ref('PublishedWriteData'),
    },
  },
  AddUnpublishedOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'add' },
      data: ref('UnpublishedWriteData'),
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
      data: ref('UnpublishTarget'),
    },
  },
  UpdateUnpublishedOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'update' },
      data: ref('UnpublishedWriteData'),
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
          meta: ref('WarningsMeta'),
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

  return compactOpenApiDocument({
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
      { name: 'changes', description: 'Capability-gated change signals (sync tokens + change feed).' },
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
      '/openapi.yaml': {
        get: {
          operationId: 'getOpenApiDocumentYaml',
          summary: 'Get this OpenAPI 3.1 document, as YAML',
          tags: ['info'],
          responses: {
            '200': {
              description: 'The OpenAPI document as YAML, with `servers[0].url` resolved against the request origin.',
              content: { 'application/yaml': { schema: { type: 'object' } } },
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
      '/sync-token': {
        get: {
          operationId: 'getSyncToken',
          summary: 'Get an opaque change token for a scope',
          description: 'Returns a token that changes whenever anything inside the scope (a folder, or the whole '
            + 'store when filter[folder] is omitted) changes. Compare tokens only by equality. Capability-gated: '
            + 'backends without change-signal support answer 501 (consult GET /capabilities, `changes`).',
          tags: ['changes'],
          parameters: [
            {
              name: 'filter[folder]',
              in: 'query',
              description: 'Scope the token to a folder. Omit for the whole store.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'The current sync token for the scope.',
              content: jsonApiContent(ref('SyncTokenResponse')),
            },
            '400': errorResponse('Repository failure mapped from its error code.'),
            '501': errorResponse('The backing repository does not support sync tokens.'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/changes': {
        get: {
          operationId: 'listChanges',
          summary: 'List changes since a sync token',
          description: 'Enumerates what changed inside the scope since a previously obtained sync token. '
            + '`meta.syncToken` on the response carries the new token to resume from. Capability-gated: backends '
            + 'without a change feed answer 501 (consult GET /capabilities, `changes`).',
          tags: ['changes'],
          parameters: [
            {
              name: 'filter[since]',
              in: 'query',
              required: true,
              description: 'A sync token previously obtained from GET /sync-token or a prior GET /changes.',
              schema: { type: 'string' },
            },
            {
              name: 'filter[folder]',
              in: 'query',
              description: 'Scope the feed to a folder. Omit for the whole store.',
              schema: { type: 'string' },
            },
            ...paginationParameters({ defaultPageSize: DEFAULT_PAGE_SIZE }),
          ],
          responses: {
            '200': {
              description: 'Change summary collection; `meta.syncToken` carries the new token.',
              content: jsonApiContent(ref('ChangesCollectionResponse')),
            },
            '400': errorResponse('Missing filter[since], an unrecognized sync token, or a bad-request failure.'),
            '501': errorResponse('The backing repository does not support a change feed.'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/records': {
        get: {
          operationId: 'listRecords',
          summary: 'List full records (published and/or unpublished view per key)',
          tags: ['records'],
          parameters: listParameters,
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
          parameters: listParameters,
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
            '409': errorResponse('A document already exists at the requested key.'),
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
            '409': errorResponse('A draft already exists at the requested key.'),
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
            '400': errorResponse('Malformed JSON, schema-invalid body, or repository failure.'),
            '404': errorResponse('Draft not found.'),
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
            '409': errorResponse('A revision already exists at the requested key.'),
          },
        },
      },
      '/revisions/{key}': {
        parameters: [keyParameter],
        get: {
          operationId: 'listRevisions',
          summary: 'List revisions for a document',
          tags: ['revisions'],
          parameters: paginationParameters({ defaultPageSize: DEFAULT_PAGE_SIZE }),
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
    components: {
      schemas,
      responses: jsonApiErrorResponseComponents(),
    },
  });
}
