/**
 * Minimal structural types for authoring OpenAPI 3.1 documents in-repo.
 *
 * Deliberately not `openapi-types` or `@apidevtools/*` — the API packages only
 * need enough structure to author specs by hand with type-checked top-level
 * shape, and pulling a spec-complete dependency would violate the
 * minimal-dependencies principle for a build-time-only concern. Schema objects
 * are left loose (`OpenApiSchema`) because JSON Schema 2020-12 (which OpenAPI
 * 3.1 embeds) is too polymorphic to model usefully without a full library.
 */

/** A JSON Schema (2020-12 dialect) object as embedded in OpenAPI 3.1. */
export type OpenApiSchema = { [key: string]: unknown };

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: OpenApiSchema;
  style?: string;
  explode?: boolean;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema;
  example?: unknown;
  examples?: Record<string, { summary?: string, value?: unknown }>;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
  headers?: Record<string, { description?: string, schema?: OpenApiSchema }>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  deprecated?: boolean;
}

export interface OpenApiPathItem {
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  put?: OpenApiOperation;
  post?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
}

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string,
    version: string,
    summary?: string,
    description?: string,
    license?: { name: string, identifier?: string, url?: string },
    contact?: { name?: string, url?: string, email?: string },
  };
  servers?: Array<{ url: string, description?: string }>;
  tags?: Array<{ name: string, description?: string }>;
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, OpenApiSchema>,
    parameters?: Record<string, OpenApiParameter>,
    responses?: Record<string, OpenApiResponse>,
    requestBodies?: Record<string, OpenApiRequestBody>,
  };
}
