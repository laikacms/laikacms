/**
 * The OpenAPI component vocabulary shared by every `api/*` JSON:API surface.
 *
 * All four handlers answer with error objects produced by the same
 * `errorToJsonApiMapper`, parse pagination with the same
 * `parsePaginationQuery`, build links with the same `buildPaginationLinks`, and
 * expose the same capability envelope — so the components describing those
 * things are authored once here rather than once per spec. Hand-maintained
 * copies had already drifted: assets required only `status`/`code` on an error
 * object where the runtime always emits four fields, and every spec advertised
 * a `links.last` no link builder can produce.
 *
 * Each builder returns freshly-allocated plain JSON so a spec can spread the
 * result into its own `components` and then override or extend single entries
 * without touching another document. Builders that emit a `$ref` reference the
 * canonical component names they themselves register ({@link
 * jsonApiErrorComponents} registers `JsonApiErrorObject` and refers to it from
 * `JsonApiError`), so callers must spread a bundle whole rather than
 * cherry-picking entries out of it.
 */

import type { OpenApiMediaType, OpenApiParameter, OpenApiResponse, OpenApiSchema } from './openapi.js';

/** The media type every `api/*` handler answers success responses with. */
export const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';

/** A reference to `#/components/schemas/{name}` in the same document. */
export function schemaRef(name: string): OpenApiSchema {
  return { $ref: `#/components/schemas/${name}` };
}

/** A single-entry `content` map carrying `schema` as a JSON:API body. */
export function jsonApiContent(schema: OpenApiSchema): Record<string, OpenApiMediaType> {
  return { [JSON_API_MEDIA_TYPE]: { schema } };
}

export interface JsonApiErrorComponentOptions {
  /**
   * Also register `Warnings` and `WarningsMeta`. Leave off for surfaces that
   * never attach `meta.warnings` to a successful response.
   */
  warnings?: boolean | undefined;
}

/**
 * `JsonApiErrorObject` and `JsonApiError` — the error document produced by
 * `errorToJsonApiMapper`, plus the `Warnings` pair that reuses the same error
 * object for recoverable failures.
 */
export function jsonApiErrorComponents(
  options: JsonApiErrorComponentOptions = {},
): Record<string, OpenApiSchema> {
  const { warnings = true } = options;

  const components: Record<string, OpenApiSchema> = {
    JsonApiErrorObject: {
      type: 'object',
      description: 'A single JSON:API error object as produced by the error responder.',
      required: ['code', 'status', 'title', 'detail'],
      properties: {
        code: { type: 'string', description: 'Machine-readable Laika error code, e.g. `not_found`, `invalid_data`.' },
        status: { type: 'string', description: 'HTTP status code as a string.' },
        title: { type: 'string' },
        detail: { type: 'string' },
        source: {
          type: 'object',
          description: 'Set on validation failures to point at the offending member or query parameter.',
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
        errors: { type: 'array', items: schemaRef('JsonApiErrorObject') },
      },
    },
  };

  if (warnings) {
    components['Warnings'] = {
      type: 'array',
      description: 'Non-fatal recoverable errors collected while producing an otherwise successful response.',
      items: schemaRef('JsonApiErrorObject'),
    };
    components['WarningsMeta'] = {
      type: 'object',
      properties: { warnings: schemaRef('Warnings') },
    };
  }

  return components;
}

/**
 * The single `ErrorResponse` entry for `components.responses`.
 *
 * Operations keep writing their error responses inline with their own wording;
 * `compactOpenApiDocument` recognises this pre-declared component as the
 * definition for that body and rewrites each occurrence into a `$ref` against
 * it, rather than minting a generated twin.
 */
export function jsonApiErrorResponseComponents(): Record<string, OpenApiResponse> {
  return {
    ErrorResponse: {
      description: 'JSON:API error document.',
      content: jsonApiContent(schemaRef('JsonApiError')),
    },
  };
}

/**
 * `ResourceLinks`, `PaginationLinks` and `CollectionMeta`.
 *
 * `PaginationLinks` deliberately omits `last`: `buildPaginationLinks` always
 * sets `self` and can produce `first`, `prev` and `next`, but no backend knows
 * a last page without a total, so nothing ever emits it.
 *
 * Requires the `Warnings` schema from {@link jsonApiErrorComponents}.
 */
export function jsonApiLinkComponents(): Record<string, OpenApiSchema> {
  return {
    ResourceLinks: {
      type: 'object',
      properties: {
        self: { type: 'string', description: 'Canonical detail URL for this resource, relative to the server origin.' },
      },
      additionalProperties: { type: 'string' },
    },
    PaginationLinks: {
      type: 'object',
      required: ['self'],
      properties: {
        self: { type: 'string' },
        first: { type: 'string' },
        prev: { type: 'string' },
        next: { type: 'string' },
      },
    },
    CollectionMeta: {
      type: 'object',
      properties: {
        page: {
          type: 'object',
          description: 'Aggregate counts; present when the backend reports a total.',
          properties: {
            total: {
              type: 'integer',
              description: 'Total number of items across all pages, when the backend knows it.',
            },
          },
        },
        warnings: schemaRef('Warnings'),
      },
    },
  };
}

export interface CapabilityComponentOptions {
  /**
   * Also register `VersionTrackingCapability`. Leave off for surfaces whose
   * capabilities envelope has no `versionTracking` member.
   */
  versionTracking?: boolean | undefined;
  /** Declare `subscription` on the supported branch of `ChangesCapability`. */
  changeSubscription?: boolean | undefined;
}

/**
 * `UnsupportedCapability` plus the capability variants a repository advertises
 * under `GET /capabilities`. Every capability is a two-branch union
 * discriminated by `supported`; the unsupported branch is identical across all
 * of them, so it is registered once and referenced.
 */
export function capabilityComponents(
  options: CapabilityComponentOptions = {},
): Record<string, OpenApiSchema> {
  const { versionTracking = false, changeSubscription = false } = options;

  const supportedChanges: OpenApiSchema = {
    type: 'object',
    required: [
      'supported',
      'description',
      'syncToken',
      'changeFeed',
      ...(changeSubscription ? ['subscription'] : []),
    ],
    properties: {
      supported: { const: true },
      description: { type: 'string' },
      syncToken: { type: 'boolean' },
      changeFeed: { type: 'boolean' },
      ...(changeSubscription ? { subscription: { type: 'boolean' } } : {}),
    },
  };

  const components: Record<string, OpenApiSchema> = {
    UnsupportedCapability: {
      type: 'object',
      description: 'The unsupported branch shared by every capability.',
      required: ['supported', 'description'],
      properties: {
        supported: { const: false },
        description: { type: 'string' },
      },
    },
    PaginationCapability: {
      oneOf: [
        schemaRef('UnsupportedCapability'),
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
    ChangesCapability: {
      oneOf: [schemaRef('UnsupportedCapability'), supportedChanges],
    },
  };

  if (versionTracking) {
    components['VersionTrackingCapability'] = {
      oneOf: [
        schemaRef('UnsupportedCapability'),
        {
          type: 'object',
          required: ['supported', 'description'],
          properties: {
            supported: { const: true },
            description: { type: 'string' },
          },
        },
      ],
    };
  }

  return components;
}

/**
 * `ApiInfoResource` and `ApiInfoResponse` for the endpoint listing served at
 * the API root. `id` is the resource id the handler reports (`documents`,
 * `storage`, …).
 */
export function apiInfoComponents(id: string): Record<string, OpenApiSchema> {
  return {
    ApiInfoResource: {
      type: 'object',
      required: ['type', 'id', 'attributes'],
      properties: {
        type: { const: 'api-info' },
        id: { const: id },
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
      properties: { data: schemaRef('ApiInfoResource') },
    },
  };
}

export interface PaginationParameterOptions {
  /**
   * Page size the handler falls back to when the request carries no `page[*]`
   * parameter at all. Documented verbatim, so it must match what the handler
   * actually does.
   */
  defaultPageSize: number;
}

/**
 * The six `page[*]` query parameters understood by `parsePaginationQuery`.
 *
 * Sizes above `MAX_PAGE_SIZE` are clamped rather than rejected, and cursor
 * parameters are refused with 400 by backends that do not declare cursor
 * support — both documented here so the behaviour is described identically on
 * every listing endpoint.
 */
export function paginationParameters(options: PaginationParameterOptions): OpenApiParameter[] {
  const { defaultPageSize } = options;

  return [
    {
      name: 'page[number]',
      in: 'query',
      description: 'Page number for page-based pagination (1-based). Defaults to 1 when no pagination key is present.',
      schema: { type: 'integer', minimum: 1 },
    },
    {
      name: 'page[size]',
      in: 'query',
      description: 'Items per page — combines with page[number], page[after], or page[before]. '
        + `Defaults to ${defaultPageSize}; values above 100 are clamped to 100 rather than rejected.`,
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
      description: 'Maximum number of items to return — combines with page[offset]. '
        + 'Values above 100 are clamped to 100.',
      schema: { type: 'integer', minimum: 1 },
    },
    {
      name: 'page[after]',
      in: 'query',
      description: 'Forward cursor. Pass an empty value to start a cursor iteration from the beginning, then '
        + 'follow links.next. Rejected with 400 when the backend does not declare cursor pagination '
        + '(consult GET /capabilities, `pagination.styles.cursor`).',
      schema: { type: 'string' },
    },
    {
      name: 'page[before]',
      in: 'query',
      description: 'Backward cursor. Rejected with 400 when the backend does not declare cursor pagination '
        + '(consult GET /capabilities, `pagination.styles.cursor`).',
      schema: { type: 'string' },
    },
  ];
}
