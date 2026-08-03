import type { OpenApiDocument, OpenApiParameter, OpenApiResponse, OpenApiSchema } from 'laikacms/json-api';

// ============================================
// Reusable Schemas
// ============================================

const ref = (name: string): OpenApiSchema => ({ $ref: `#/components/schemas/${name}` });

const errorObjectSchema: OpenApiSchema = {
  type: 'object',
  required: ['status', 'code'],
  properties: {
    status: { type: 'string', description: 'HTTP status code as a string.' },
    code: { type: 'string', description: 'Machine-readable LaikaError code (e.g. not_found, invalid_data).' },
    title: { type: 'string' },
    detail: { type: 'string' },
  },
};

const jsonApiErrorSchema: OpenApiSchema = {
  type: 'object',
  required: ['errors'],
  properties: {
    errors: { type: 'array', items: ref('ErrorObject') },
  },
};

const warningsSchema: OpenApiSchema = {
  type: 'array',
  description: 'Recoverable errors collected while fulfilling the request '
    + '(e.g. an unreadable subfolder or a missing variation). The request '
    + 'itself still succeeded.',
  items: ref('ErrorObject'),
};

const assetAttributesSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'content'],
  properties: {
    type: { type: 'string', const: 'asset' },
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

const assetResourceSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { type: 'string', const: 'asset' },
    id: { type: 'string', description: 'The asset key.' },
    attributes: ref('AssetAttributes'),
    meta: ref('AssetMetadata'),
    relationships: {
      type: 'object',
      description: 'Advertised only when the corresponding `?include=` value was requested.',
      properties: {
        urls: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'asset-url' },
                id: { type: 'string' },
              },
            },
          },
        },
        variations: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'asset-variation' },
                id: { type: 'string' },
              },
            },
          },
        },
      },
    },
    links: ref('ResourceLinks'),
  },
};

const folderResourceSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { type: 'string', const: 'folder' },
    id: { type: 'string', description: 'The folder key.' },
    attributes: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { type: 'string', const: 'folder' },
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
    type: { type: 'string', const: 'asset-url' },
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
    type: { type: 'string', const: 'asset-variation' },
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

const capabilitiesResourceSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { type: 'string', const: 'assets-capabilities' },
    id: { type: 'string', const: 'self' },
    attributes: {
      type: 'object',
      required: ['compatibilityDate', 'pagination', 'versionTracking', 'changes'],
      properties: {
        compatibilityDate: { type: 'string' },
        pagination: {
          oneOf: [
            {
              type: 'object',
              required: ['supported', 'description'],
              properties: {
                supported: { type: 'boolean', const: false },
                description: { type: 'string' },
              },
            },
            {
              type: 'object',
              required: ['supported', 'description', 'styles'],
              properties: {
                supported: { type: 'boolean', const: true },
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
        versionTracking: {
          oneOf: [
            {
              type: 'object',
              required: ['supported', 'description'],
              properties: {
                supported: { type: 'boolean', const: false },
                description: { type: 'string' },
              },
            },
            {
              type: 'object',
              required: ['supported', 'description'],
              properties: {
                supported: { type: 'boolean', const: true },
                description: { type: 'string' },
              },
            },
          ],
        },
        changes: {
          oneOf: [
            {
              type: 'object',
              required: ['supported', 'description'],
              properties: {
                supported: { type: 'boolean', const: false },
                description: { type: 'string' },
              },
            },
            {
              type: 'object',
              required: ['supported', 'description', 'syncToken', 'changeFeed'],
              properties: {
                supported: { type: 'boolean', const: true },
                description: { type: 'string' },
                syncToken: { type: 'boolean' },
                changeFeed: { type: 'boolean' },
              },
            },
          ],
        },
        filtering: {
          description: 'Named listing filters honored by GET /resources as filter[<name>] query '
            + 'parameters. Absent means unsupported. Undeclared filter names are rejected with 400.',
          oneOf: [
            {
              type: 'object',
              required: ['supported', 'description'],
              properties: {
                supported: { type: 'boolean', const: false },
                description: { type: 'string' },
              },
            },
            {
              type: 'object',
              required: ['supported', 'description', 'filters'],
              properties: {
                supported: { type: 'boolean', const: true },
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
        },
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
        type: { type: 'string', const: 'sync-token' },
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
    meta: {
      type: 'object',
      properties: { warnings: ref('Warnings') },
    },
  },
};

const changeSummaryResourceSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { type: 'string', const: 'change-summary' },
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
    meta: {
      type: 'object',
      properties: {
        page: {
          type: 'object',
          properties: { total: { type: 'integer' } },
        },
        syncToken: { type: 'string', description: 'The new sync token to resume from.' },
        warnings: ref('Warnings'),
      },
    },
  },
};

const resourceDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: ref('Resource'),
    included: { type: 'array', items: ref('IncludedResource') },
    meta: {
      type: 'object',
      properties: { warnings: ref('Warnings') },
    },
  },
};

const assetDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: ref('AssetResource'),
    meta: {
      type: 'object',
      properties: { warnings: ref('Warnings') },
    },
  },
};

const folderDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: ref('FolderResource'),
    meta: {
      type: 'object',
      properties: { warnings: ref('Warnings') },
    },
  },
};

const resourceCollectionDocumentSchema: OpenApiSchema = {
  type: 'object',
  required: ['data'],
  properties: {
    data: { type: 'array', items: ref('Resource') },
    included: { type: 'array', items: ref('IncludedResource') },
    links: {
      type: 'object',
      description: 'Pagination links. next/prev/first/last are present depending on position and pagination style.',
      properties: {
        self: { type: ['string', 'null'] },
        first: { type: ['string', 'null'] },
        prev: { type: ['string', 'null'] },
        next: { type: ['string', 'null'] },
        last: { type: ['string', 'null'] },
      },
      additionalProperties: { type: ['string', 'null'] },
    },
    meta: {
      type: 'object',
      properties: {
        page: {
          type: 'object',
          properties: {
            total: { type: 'number', description: 'Total number of resources when the backend reports it.' },
          },
        },
        warnings: ref('Warnings'),
      },
    },
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
        deleted: { type: 'boolean', const: true },
        warnings: ref('Warnings'),
      },
    },
  },
};

const assetCreateDataSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { type: 'string', const: 'asset' },
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
    type: { type: 'string', const: 'folder' },
    id: { type: 'string', description: 'The folder key to create.' },
    attributes: {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'folder' },
      },
    },
  },
};

const assetUpdateDataSchema: OpenApiSchema = {
  type: 'object',
  required: ['type', 'attributes'],
  properties: {
    type: { type: 'string', const: 'asset' },
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

const jsonApiContent = (schemaName: string) => ({
  'application/vnd.api+json': { schema: ref(schemaName) },
});

const errorResponse = (description: string): OpenApiResponse => ({
  description,
  content: jsonApiContent('JsonApiError'),
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

  return {
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
              content: jsonApiContent('CapabilitiesDocument'),
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
              content: jsonApiContent('SyncTokenDocument'),
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
              content: jsonApiContent('ChangesCollectionDocument'),
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
            {
              name: 'page[size]',
              in: 'query',
              description: 'Items per page. Defaults to 100.',
              schema: { type: 'integer', default: 100 },
            },
            {
              name: 'page[number]',
              in: 'query',
              description: '1-based page number (page-based pagination).',
              schema: { type: 'integer', minimum: 1 },
            },
            {
              name: 'page[after]',
              in: 'query',
              description: 'Cursor: return items after this opaque cursor position. Pass an empty value to '
                + 'start a cursor iteration from the beginning; follow links.next to continue it. Rejected '
                + 'with 400 when the backend declares cursor pagination unsupported (see GET /capabilities).',
              schema: { type: 'string' },
            },
            {
              name: 'page[before]',
              in: 'query',
              description: 'Cursor: return items before this resource key. Rejected with 400 when the '
                + 'backend declares cursor pagination unsupported (see GET /capabilities).',
              schema: { type: 'string' },
            },
            {
              name: 'page[offset]',
              in: 'query',
              description: 'Offset-based pagination: number of items to skip.',
              schema: { type: 'integer', minimum: 0 },
            },
            {
              name: 'page[limit]',
              in: 'query',
              description: 'Offset-based pagination: maximum items to return.',
              schema: { type: 'integer', minimum: 1 },
            },
            includeParameter,
            metaParameter,
          ],
          responses: {
            '200': {
              description: 'A page of resources, with pagination links and optional meta.page.total / '
                + 'meta.warnings.',
              content: jsonApiContent('ResourceCollectionDocument'),
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
              content: jsonApiContent('ResourceDocument'),
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
              content: jsonApiContent('AssetDocument'),
            },
            '400': errorResponse('Invalid request body, invalid update data, or repository failure.'),
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
              content: jsonApiContent('DeleteResultDocument'),
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
        ErrorObject: errorObjectSchema,
        JsonApiError: jsonApiErrorSchema,
        Warnings: warningsSchema,
        ResourceLinks: {
          type: 'object',
          properties: {
            self: {
              type: 'string',
              description: 'Canonical detail URL for this resource, relative to the server root.',
            },
          },
          additionalProperties: { type: 'string' },
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
        AssetDocument: assetDocumentSchema,
        FolderDocument: folderDocumentSchema,
        ResourceCollectionDocument: resourceCollectionDocumentSchema,
        CapabilitiesDocument: capabilitiesDocumentSchema,
        DeleteResultDocument: deleteResultDocumentSchema,
        AssetCreateData: assetCreateDataSchema,
        FolderCreateData: folderCreateDataSchema,
        AssetUpdateData: assetUpdateDataSchema,
      },
    },
  };
}
