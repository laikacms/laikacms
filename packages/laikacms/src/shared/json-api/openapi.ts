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

/**
 * Serialize an OpenAPI document to YAML.
 *
 * A hand-rolled block-style writer rather than a `js-yaml` dependency — same
 * minimal-dependencies reasoning as the types above. The document is plain JSON
 * data (no cycles, no non-JSON values), which keeps the serializer small: every
 * string is emitted as a JSON double-quoted scalar (a JSON string is always a
 * valid YAML double-quoted scalar), so YAML's quoting rules never come up.
 */
export function openApiDocumentToYaml(doc: OpenApiDocument): string {
  const lines: string[] = [];
  writeMapping(doc as unknown as Record<string, unknown>, 0, lines);
  return lines.join('\n') + '\n';
}

/** Bare keys that are safe unquoted; anything else (paths, status codes,
 * media types) is JSON-quoted. */
const SAFE_YAML_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function formatYamlKey(key: string): string {
  return SAFE_YAML_KEY.test(key) ? key : JSON.stringify(key);
}

function formatYamlScalar(value: null | undefined | boolean | number | string): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  return JSON.stringify(value);
}

function isYamlScalar(value: unknown): value is null | undefined | boolean | number | string {
  return value === null || value === undefined || typeof value !== 'object';
}

function writeMapping(obj: Record<string, unknown>, indent: number, lines: string[]): void {
  const pad = '  '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    writeValue(`${pad}${formatYamlKey(key)}:`, value, indent, lines);
  }
}

function writeSequence(arr: unknown[], indent: number, lines: string[]): void {
  const pad = '  '.repeat(indent);
  for (const item of arr) {
    writeValue(`${pad}-`, item, indent, lines);
  }
}

/**
 * Emit `value` after the already-computed `prefix` (`key:` or `-`), inlining
 * scalars and empty containers and dropping to a nested block otherwise.
 */
function writeValue(prefix: string, value: unknown, indent: number, lines: string[]): void {
  if (isYamlScalar(value)) {
    lines.push(`${prefix} ${formatYamlScalar(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${prefix} []`);
      return;
    }
    lines.push(prefix);
    writeSequence(value, indent + 1, lines);
    return;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
  if (keys.length === 0) {
    lines.push(`${prefix} {}`);
    return;
  }
  lines.push(prefix);
  writeMapping(obj, indent + 1, lines);
}
