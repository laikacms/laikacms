import type { OpenApiDocument, OpenApiParameter, OpenApiResponse, OpenApiSchema } from 'laikacms/json-api';
import {
  capabilityComponents,
  compactOpenApiDocument,
  jsonApiContent,
  jsonApiErrorComponents,
  jsonApiErrorResponseComponents,
  jsonApiLinkComponents,
  paginationParameters,
  schemaRef as ref,
} from 'laikacms/json-api';

// ============================================
// Reusable Schemas
// ============================================

/** Page size the handler lists with when the request carries no `page[*]` key. */
const DEFAULT_PAGE_SIZE = 100;

const assetAttributesSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'content'],
  properties: {
    type: { const: 'asset' },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp.' },
    updatedAt: { type: 'string', description: 'ISO 8601 last-update timestamp.' },
    content: {
      type: 'object',
      description: 'Implementation-specific content descriptor (e.g. size, etag).',
      additionalProperties: true,
    },
  },
};

const assetMetadataSchema: OpenApiSchema = {
  type: 'object',
  description: 'Intrinsic asset metadata, discriminated by `kind`. Kind-specific '
    + 'fields (width/height, duration, pageCount, ...) appear alongside the '
    + 'base fields. Only present when the request opted in via `?meta=true`.',
  required: ['kind', 'size', 'mimeType'],
  properties: {
    kind: { type: 'string', enum: ['image', 'video', 'audio', 'document', 'binary'] },
    size: { type: 'number', description: 'File size in bytes.' },
    mimeType: { type: 'string' },
    filename: { type: 'string' },
    extension: { type: 'string' },
    hash: { type: 'string' },
    hashAlgorithm: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    modifiedAt: { type: 'string', format: 'date-time' },
  },
  additionalProperties: true,
};

/** A to-one relationship, advertised only when the matching `?include=` was asked for. */
const relationship = (typeName: string): OpenApiSchema => ({
  type: 'object',
  properties: {
    data: {
      type: 'object',
      properties: {
        type: { const: typeName },
        id: { type: 'string' },
      },
    },
  },
});

const assetResourceSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: 'asset' },
    id: { type: 'string', description: 'The asset key.' },
    attributes: ref('AssetAttributes'),
    meta: ref('AssetMetadata'),
    relationships: {
      type: 'object',
      description: 'Advertised only when the corresponding `?include=` value was requested.',
      properties: {
        urls: relationship('asset-url'),
        variations: relationship('asset-variation'),
      },
    },
    links: ref('ResourceLinks'),
  },
};

const folderResourceSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: 'folder' },
    id: { type: 'string', description: 'The folder key.' },
    attributes: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { const: 'folder' },
        createdAt: { type: 'string', description: 'ISO 8601 creation timestamp.' },
        updatedAt: { type: 'string', description: 'ISO 8601 last-update timestamp.' },
      },
    },
    links: ref('ResourceLinks'),
  },
};

const assetUrlResourceSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: 'asset-url' },
    id: { type: 'string', description: 'The asset key these URLs belong to.' },
    attributes: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Direct download URL for the asset.' },
        expiresAt: { type: 'string', format: 'date-time', description: 'Expiration for signed URLs.' },
      },
    },
  },
};

const assetVariationSchema: OpenApiSchema = {
  type: 'object',
  required: ['variant', 'url'],
  properties: {
    variant: { type: 'string', description: "Variation identifier (e.g. 'thumbnail', '100x100')." },
    url: {
      type: 'string',
      description: 'URL for this variation. May contain {width}/{height} template variables.',
    },
    width: { type: 'integer' },
    height: { type: 'integer' },
    mimeType: { type: 'string' },
    size: { type: 'integer' },
  },
};

const assetVariationResourceSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: 'asset-variation' },
    id: { type: 'string', description: 'The asset key these variations belong to.' },
    attributes: {
      type: 'object',
      required: ['variations'],
      properties: {
        variations: {
          type: 'object',
          additionalProperties: ref('AssetVariation'),
        },
      },
    },
  },
};

const filteringCapabilitySchema: OpenApiSchema = {
  description: 'Named listing filters honored by GET /resources as filter[<name>] query '
    + 'parameters. Absent means unsupported. Undeclared filter names are rejected with 400.',
  oneOf: [
    ref('UnsupportedCapability'),
    {
      type: 'object',
      required: ['supported', 'description', 'filters'],
      properties: {
        supported: { const: true },
        description: { type: 'string' },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'description'],
            properties: {
              name: { type: 'string', description: "Wire name, used as filter[<name>] (e.g. 'search')." },
              description: { type: 'string' },
            },
          },
        },
      },
    },
  ],
};

const capabilitiesResourceSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: 'assets-capabilities' },
    id: { const: 'self' },
    attributes: {
      type: 'object',
      required: ['compatibilityDate', 'pagination', 'versionTracking', 'changes'],
      properties: {
        compatibilityDate: { type: 'string' },
        pagination: ref('PaginationCapability'),
        versionTracking: ref('VersionTrackingCapability'),
        changes: ref('ChangesCapability'),
        filtering: ref('FilteringCapability'),
      },
    },
    links: ref('ResourceLinks'),
  },
};

const syncTokenDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
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
    meta: ref('WarningsMeta'),
  },
};

const changeSummaryResourceSchema: OpenApiSchema = {
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
          description: 'Opaque per-record version token after the change. Omitted for deletions and on '
            + 'backends without version tracking.',
        },
      },
    },
  },
};

const changesCollectionDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: { type: 'array', items: ref('ChangeSummaryResource') },
    meta: ref('ChangesMeta'),
  },
};

/** A JSON:API response document wrapping one resource, plus warnings meta. */
const resourceDocument = (resourceSchemaName: string): OpenApiSchema => ({
  type: 'object',
  required: ['data'],
  properties: {
    data: ref(resourceSchemaName),
    meta: ref('WarningsMeta'),
  },
});

const resourceDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: ref('Resource'),
    included: { type: 'array', items: ref('IncludedResource') },
    meta: ref('WarningsMeta'),
  },
};

const resourceCollectionDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: { type: 'array', items: ref('Resource') },
    included: { type: 'array', items: ref('IncludedResource') },
    links: ref('PaginationLinks'),
    meta: ref('CollectionMeta'),
  },
};

const capabilitiesDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: ref('CapabilitiesResource'),
  },
};

const deleteResultDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['meta'],
  properties: {
    meta: {
      type: 'object',
      required: ['deleted', 'warnings'],
      properties: {
        deleted: { const: true },
        warnings: ref('Warnings'),
      },
    },
  },
};

const assetCreateDataSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: 'asset' },
    id: { type: 'string', description: 'The asset key to create.' },
    attributes: {
      type: 'object',
      required: ['content'],
      properties: {
        mimeType: { type: 'string', description: "Defaults to 'application/octet-stream' when omitted." },
        filename: { type: 'string' },
        cacheControl: { type: 'string' },
        customMetadata: { type: 'object', additionalProperties: { type: 'string' } },
        content: {
          type: 'string',
          contentEncoding: 'base64',
          description: 'Base64-encoded binary content. Requests without content are rejected with 400; '
            + 'use multipart/form-data for large binary uploads.',
        },
      },
    },
  },
};

const folderCreateDataSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: 'folder' },
    id: { type: 'string', description: 'The folder key to create.' },
    attributes: {
      type: 'object',
      properties: {
        type: { const: 'folder' },
      },
    },
  },
};

const assetUpdateDataSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'attributes'],
  properties: {
    type: { const: 'asset' },
    attributes: {
      type: 'object',
      properties: {
        mimeType: { type: 'string' },
        cacheControl: { type: 'string' },
        customMetadata: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
  },
};

// ============================================
// Reusable Parameters & Responses
// ============================================

const keyParameter: OpenApiParameter = {
  name: 'key',
  in: 'path',
  required: true,
  description: 'URL-encoded resource key. Keys may contain slashes; encode them (e.g. images%2Fphoto.jpg).',
  schema: { type: 'string' },
};

const includeParameter: OpenApiParameter = {
  name: 'include',
  in: 'query',
  description: 'Comma-separated related resources to sideload into `included`: '
    + '`urls`, `variations` (long-form aliases `asset-url`, `asset-variation` are also accepted).',
  schema: { type: 'string' },
};

const metaParameter: OpenApiParameter = {
  name: 'meta',
  in: 'query',
  description: 'Set to `true` (or `1`, `yes`) to inline intrinsic asset metadata on `data.meta`.',
  schema: { type: 'string' },
};

const folderScopeParameters: OpenApiParameter[] = [
  {
    name: 'folder',
    in: 'query',
    description: 'Folder key to list. Takes precedence over filter[folder] and filter[prefix]. '
      + 'Defaults to the root folder.',
    schema: { type: 'string' },
  },
  {
    name: 'filter[folder]',
    in: 'query',
    description: 'Alias for `folder`.',
    schema: { type: 'string' },
  },
  {
    name: 'filter[prefix]',
    in: 'query',
    description: 'Alias for `folder`.',
    schema: { type: 'string' },
  },
  {
    name: 'filter[depth]',
    in: 'query',
    description: 'How many folder levels deep to walk. Clamped to a minimum of 1. '
      + 'Takes precedence over `depth`.',
    schema: { type: 'integer', minimum: 1, default: 1 },
  },
  {
    name: 'depth',
    in: 'query',
    description: 'Alias for `filter[depth]`.',
    schema: { type: 'integer', minimum: 1, default: 1 },
  },
  {
    name: 'filter[search]',
    in: 'query',
    description: 'Listing filter (when declared by the backend): case-insensitive substring match '
      + 'on the resource key. Listing filters are generic — any filter[<name>] declared in GET '
      + '/capabilities under `filtering.filters` is forwarded to the backend; undeclared names are '
      + 'rejected with 400.',
    schema: { type: 'string' },
  },
];

// Authored inline so every operation keeps its own wording; the document is run
// through `compactOpenApiDocument` on the way out, which folds each occurrence
// into a `$ref` against the `ErrorResponse` component.
const errorResponse = (description: string): OpenApiResponse => ({
  description,
  content: jsonApiContent(ref('JsonApiError')),
});

const internalErrorResponse = errorResponse('Unexpected error while handling the request.');

// ============================================
// Document Builder
// ============================================

/**
 * Build the OpenAPI 3.1 description of the assets JSON:API handler produced by
 * `buildAssetsApi`. Path keys are relative to `basePath`, which is emitted as
 * the single `servers` entry.
 */
export function buildAssetsOpenApi(options: { basePath?: string } = {}): OpenApiDocument {
  const { basePath = '/api/assets' } = options;

  return compactOpenApiDocument({
    openapi: '3.1.0',
    info: {
      title: 'Laika CMS Assets API',
      version: '1.0.1',
      description: 'JSON:API-style HTTP interface over a Laika CMS assets repository: list, fetch, '
        + 'upload, update and delete assets and folders, plus capability introspection. '
        + 'Success responses use the application/vnd.api+json media type. '
        + '⚠️ The handler ships no authentication — wrap it (e.g. with laikacms/decap-api or a custom '
        + 'middleware that validates a Bearer token) before exposing it to an untrusted network, '
        + 'otherwise anyone who can reach it can list, upload, modify, and delete asset binaries.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: basePath }],
    tags: [
      { name: 'Resources', description: 'Assets and folders.' },
      { name: 'Capabilities', description: 'Introspection of what the underlying assets backend supports.' },
      { name: 'Changes', description: 'Capability-gated change signals (sync tokens + change feed).' },
      { name: 'Meta', description: 'API self-description.' },
    ],
    paths: {
      '/openapi.json': {
        get: {
          operationId: 'getOpenApiDocument',
          summary: 'Get this OpenAPI document',
          tags: ['Meta'],
          responses: {
            '200': {
              description: 'The OpenAPI 3.1 document describing this API, with `servers` rewritten '
                + 'to the absolute mount point of the handler.',
              content: {
                'application/json': { schema: { type: 'object' } },
              },
            },
            '500': internalErrorResponse,
          },
        },
      },
      '/openapi.yaml': {
        get: {
          operationId: 'getOpenApiDocumentYaml',
          summary: 'Get this OpenAPI document as YAML',
          tags: ['Meta'],
          responses: {
            '200': {
              description: 'The OpenAPI 3.1 document describing this API, serialized as YAML, with '
                + '`servers` rewritten to the absolute mount point of the handler.',
              content: {
                'application/yaml': { schema: { type: 'object' } },
              },
            },
            '500': internalErrorResponse,
          },
        },
      },
      '/capabilities': {
        get: {
          operationId: 'getCapabilities',
          summary: 'Get backend capabilities',
          description: 'Surfaces the underlying assets repository capabilities (compatibility date, '
            + 'supported pagination styles) so clients can introspect what the backend supports '
            + 'instead of guessing.',
          tags: ['Capabilities'],
          responses: {
            '200': {
              description: 'The capabilities resource.',
              content: jsonApiContent(ref('CapabilitiesDocument')),
            },
            '500': internalErrorResponse,
            default: errorResponse(
              'Repository failure, with the HTTP status mapped from the LaikaError code (e.g. 404, 500).',
            ),
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
          tags: ['Changes'],
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
              content: jsonApiContent(ref('SyncTokenDocument')),
            },
            '501': errorResponse('The backing repository does not support sync tokens.'),
            '500': internalErrorResponse,
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
          tags: ['Changes'],
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
          ],
          responses: {
            '200': {
              description: 'Change summary collection; `meta.syncToken` carries the new token.',
              content: jsonApiContent(ref('ChangesCollectionDocument')),
            },
            '400': errorResponse('Missing filter[since] or an unrecognized sync token.'),
            '501': errorResponse('The backing repository does not support a change feed.'),
            '500': internalErrorResponse,
          },
        },
      },
      '/resources': {
        get: {
          operationId: 'listResources',
          summary: 'List resources in a folder',
          tags: ['Resources'],
          parameters: [
            ...folderScopeParameters,
            ...paginationParameters({ defaultPageSize: DEFAULT_PAGE_SIZE }),
            includeParameter,
            metaParameter,
          ],
          responses: {
            '200': {
              description: 'A page of resources, with pagination links and optional meta.page.total / '
                + 'meta.warnings.',
              content: jsonApiContent(ref('ResourceCollectionDocument')),
            },
            '400': errorResponse(
              'Listing failed, or a cursor parameter was used against a backend without cursor support.',
            ),
            '500': internalErrorResponse,
          },
        },
        post: {
          operationId: 'createResource',
          summary: 'Create an asset or folder',
          tags: ['Resources'],
          requestBody: {
            required: true,
            description: 'Either a multipart upload (binary asset) or a JSON:API document creating a '
              + 'folder or a base64-encoded asset. Any other Content-Type is rejected with 400.',
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: {
                      type: 'string',
                      contentMediaType: 'application/octet-stream',
                      description: 'The binary file to upload. Its name/type are used as fallbacks '
                        + 'for key, filename and mimeType.',
                    },
                    metadata: {
                      type: 'string',
                      description: 'Optional JSON-encoded object with key, mimeType, filename, '
                        + 'customMetadata and cacheControl. Individual form fields take precedence.',
                    },
                    key: { type: 'string', description: 'Asset key. Falls back to metadata.key, then the file name.' },
                    mimeType: {
                      type: 'string',
                      description: "Falls back to the file's type, then 'application/octet-stream'.",
                    },
                    filename: { type: 'string', description: 'Falls back to the file name.' },
                    cacheControl: { type: 'string' },
                    customMetadata: {
                      type: 'string',
                      description: 'JSON-encoded string-to-string record. Invalid JSON is ignored.',
                    },
                  },
                },
              },
              'application/vnd.api+json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      oneOf: [ref('AssetCreateData'), ref('FolderCreateData')],
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'The created asset or folder.',
              content: {
                'application/vnd.api+json': {
                  schema: { oneOf: [ref('AssetDocument'), ref('FolderDocument')] },
                },
              },
            },
            '400': errorResponse(
              'Missing file or content, invalid body, unsupported Content-Type, invalid resource type, '
                + 'or repository failure.',
            ),
            '409': errorResponse('An asset or folder already exists at the requested key.'),
            '500': internalErrorResponse,
          },
        },
      },
      '/resources/{key}': {
        parameters: [keyParameter],
        get: {
          operationId: 'getResource',
          summary: 'Get a single resource by key',
          tags: ['Resources'],
          parameters: [includeParameter, metaParameter],
          responses: {
            '200': {
              description: 'The resource, with optional included related resources and meta.warnings.',
              content: jsonApiContent(ref('ResourceDocument')),
            },
            '404': errorResponse('Resource not found.'),
            '500': internalErrorResponse,
          },
        },
        patch: {
          operationId: 'updateAsset',
          summary: 'Update an asset',
          description: 'Updates asset metadata (mimeType, cacheControl, customMetadata). '
            + 'The key in the URL is used as the resource id; an id in the body is ignored.',
          tags: ['Resources'],
          requestBody: {
            required: true,
            content: {
              'application/vnd.api+json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: ref('AssetUpdateData'),
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'The updated asset.',
              content: jsonApiContent(ref('AssetDocument')),
            },
            '400': errorResponse('Invalid request body, invalid update data, or repository failure.'),
            '404': errorResponse('Asset not found.'),
            '500': internalErrorResponse,
          },
        },
        delete: {
          operationId: 'deleteResource',
          summary: 'Delete an asset or folder',
          description: 'Looks the resource up first to decide between asset and folder deletion.',
          tags: ['Resources'],
          parameters: [
            {
              name: 'recursive',
              in: 'query',
              description: "Set to 'true' to delete a folder and its contents recursively.",
              schema: { type: 'string', enum: ['true', 'false'] },
            },
          ],
          responses: {
            '204': { description: 'Deleted cleanly with no warnings.' },
            '200': {
              description: 'Deleted, but recoverable warnings were collected (HTTP 204 forbids a body).',
              content: jsonApiContent(ref('DeleteResultDocument')),
            },
            '404': errorResponse('Resource not found.'),
            '400': errorResponse('Deletion failed.'),
            '500': internalErrorResponse,
          },
        },
      },
    },
    components: {
      schemas: {
        ...jsonApiErrorComponents(),
        ...jsonApiLinkComponents(),
        ...capabilityComponents({ versionTracking: true }),
        FilteringCapability: filteringCapabilitySchema,
        ChangesMeta: {
          allOf: [
            ref('CollectionMeta'),
            {
              type: 'object',
              properties: {
                syncToken: { type: 'string', description: 'The new sync token to resume from.' },
              },
            },
          ],
        },
        AssetAttributes: assetAttributesSchema,
        AssetMetadata: assetMetadataSchema,
        AssetResource: assetResourceSchema,
        FolderResource: folderResourceSchema,
        Resource: { oneOf: [ref('AssetResource'), ref('FolderResource')] },
        AssetUrlResource: assetUrlResourceSchema,
        AssetVariation: assetVariationSchema,
        AssetVariationResource: assetVariationResourceSchema,
        IncludedResource: { oneOf: [ref('AssetUrlResource'), ref('AssetVariationResource')] },
        CapabilitiesResource: capabilitiesResourceSchema,
        SyncTokenDocument: syncTokenDocumentSchema,
        ChangeSummaryResource: changeSummaryResourceSchema,
        ChangesCollectionDocument: changesCollectionDocumentSchema,
        ResourceDocument: resourceDocumentSchema,
        AssetDocument: resourceDocument('AssetResource'),
        FolderDocument: resourceDocument('FolderResource'),
        ResourceCollectionDocument: resourceCollectionDocumentSchema,
        CapabilitiesDocument: capabilitiesDocumentSchema,
        DeleteResultDocument: deleteResultDocumentSchema,
        AssetCreateData: assetCreateDataSchema,
        FolderCreateData: folderCreateDataSchema,
        AssetUpdateData: assetUpdateDataSchema,
      },
      responses: jsonApiErrorResponseComponents(),
    },
  });
}
