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

/**
 * An OpenAPI 3.1 Reference Object, used where a document points at
 * `#/components/...` instead of inlining the object.
 *
 * `summary` and `description` are siblings 3.1 permits next to `$ref`; they
 * override the referenced object's own, which is what lets a shared error
 * response carry a per-operation description.
 */
export interface OpenApiRef {
  $ref: string;
  summary?: string;
  description?: string;
}

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
  parameters?: Array<OpenApiParameter | OpenApiRef>;
  requestBody?: OpenApiRequestBody | OpenApiRef;
  responses: Record<string, OpenApiResponse | OpenApiRef>;
  deprecated?: boolean;
}

export interface OpenApiPathItem {
  summary?: string;
  description?: string;
  parameters?: Array<OpenApiParameter | OpenApiRef>;
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

/** Path-item keys that hold an operation, as opposed to shared metadata. */
const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

const isRef = (value: unknown): value is OpenApiRef =>
  typeof value === 'object' && value !== null && typeof (value as OpenApiRef).$ref === 'string';

/** PascalCase identifier from arbitrary prose, capped so refs stay short. */
function componentName(source: string, words = 4): string {
  const name = source
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, words)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return name || 'Component';
}

function uniqueName(taken: Record<string, unknown>, base: string): string {
  if (!(base in taken)) return base;
  let suffix = 2;
  while (`${base}${suffix}` in taken) suffix += 1;
  return `${base}${suffix}`;
}

/** Every operation in the document, plus the path items themselves. */
function eachOperation(doc: OpenApiDocument): OpenApiOperation[] {
  return Object.values(doc.paths).flatMap(item =>
    HTTP_METHODS.flatMap(method => {
      const operation = item[method];
      return operation ? [operation] : [];
    })
  );
}

/**
 * Hoist repeated inline responses and parameters into `components`, replacing
 * each occurrence with a `$ref`.
 *
 * Authoring the paths with plain helper calls (`errorResponse('...')`,
 * `paginationParameters`) is the readable way to write a spec, but it inlines
 * the same objects over and over: the documents API repeats one 400-response
 * body 7 times and the six `page[*]` parameters 4 times each, which is ~12% of
 * the served document. Callers still write the spec inline; this pass
 * normalizes it on the way out, so the wire form stays small without the
 * source becoming a wall of `$ref`s.
 *
 * Responses are grouped by body, not by whole object: OpenAPI 3.1 lets a
 * Reference Object carry its own `description` that overrides the target's (see
 * `OpenApiRef`), so operations sharing an error body keep their specific
 * wording while sharing one definition.
 *
 * Lossless after `$ref` resolution - a client that dereferences the result gets
 * the same document back.
 */
export function compactOpenApiDocument(source: OpenApiDocument): OpenApiDocument {
  // Rewrites happen in place, and the builders share parameter objects and
  // helper results across paths - so work on a copy. The document is plain JSON
  // data (same assumption the YAML writer makes), so a round-trip clones it.
  const doc: OpenApiDocument = JSON.parse(JSON.stringify(source));
  const responses: Record<string, OpenApiResponse> = { ...doc.components?.responses };
  const parameters: Record<string, OpenApiParameter> = { ...doc.components?.parameters };

  // -- responses: group by body (everything except `description`) ------------
  interface ResponseGroup {
    body: Omit<OpenApiResponse, 'description'>;
    slots: { holder: Record<string, OpenApiResponse | OpenApiRef>, key: string, description: string }[];
    descriptionCounts: Map<string, number>;
  }
  const responseGroups = new Map<string, ResponseGroup>();

  for (const operation of eachOperation(doc)) {
    for (const [code, response] of Object.entries(operation.responses)) {
      if (isRef(response)) continue;
      const { description, ...body } = response;
      // A response with no body is already as small as a `$ref` would be.
      if (Object.keys(body).length === 0) continue;

      const groupKey = JSON.stringify(body);
      const group: ResponseGroup = responseGroups.get(groupKey)
        ?? { body, slots: [], descriptionCounts: new Map() };
      group.slots.push({ holder: operation.responses, key: code, description });
      group.descriptionCounts.set(description, (group.descriptionCounts.get(description) ?? 0) + 1);
      responseGroups.set(groupKey, group);
    }
  }

  for (const [groupKey, group] of responseGroups) {
    // An identical component may already be declared (the JSON:API packs ship
    // `ErrorResponse`); prefer wiring the paths to it over minting a twin.
    const existing = Object.entries(responses).find(([, candidate]) => {
      const { description: _description, ...body } = candidate;
      return JSON.stringify(body) === groupKey;
    });

    if (!existing && group.slots.length < 2) continue;

    let name: string;
    let defaultDescription: string;
    if (existing) {
      [name, { description: defaultDescription }] = existing;
    } else {
      // Name after the schema the body carries (`JsonApiError` -> `JsonApiErrorResponse`),
      // which reads better in a `$ref` than a slug of one operation's prose.
      const schemaRef = Object.values(group.body.content ?? {})
        .map(media => media.schema?.['$ref'])
        .find((value): value is string => typeof value === 'string');
      const schemaName = schemaRef ? componentName(schemaRef.split('/').pop() ?? '') : '';
      // `PublishedResponse` already reads as a response; don't make it `PublishedResponseResponse`.
      const base = schemaName
        ? (schemaName.endsWith('Response') ? schemaName : `${schemaName}Response`)
        : 'SharedResponse';
      name = uniqueName(responses, base);

      // The most common wording becomes the definition's own description; the
      // rest override it per operation. Sort is stable, so ties keep authoring order.
      const ranked = [...group.descriptionCounts.entries()].sort((a, b) => b[1] - a[1]);
      defaultDescription = ranked[0]?.[0] ?? '';
      responses[name] = { description: defaultDescription, ...group.body };
    }

    for (const slot of group.slots) {
      slot.holder[slot.key] = slot.description === defaultDescription
        ? { $ref: `#/components/responses/${name}` }
        : { $ref: `#/components/responses/${name}`, description: slot.description };
    }
  }

  // -- parameters: group by the whole object --------------------------------
  const parameterGroups = new Map<
    string,
    { parameter: OpenApiParameter, slots: { list: Array<OpenApiParameter | OpenApiRef>, index: number }[] }
  >();
  const parameterLists = [
    ...Object.values(doc.paths).map(item => item.parameters),
    ...eachOperation(doc).map(operation => operation.parameters),
  ];

  for (const list of parameterLists) {
    if (!list) continue;
    list.forEach((parameter, index) => {
      if (isRef(parameter)) return;
      const groupKey = JSON.stringify(parameter);
      const group = parameterGroups.get(groupKey) ?? { parameter, slots: [] };
      group.slots.push({ list, index });
      parameterGroups.set(groupKey, group);
    });
  }

  for (const group of parameterGroups.values()) {
    if (group.slots.length < 2) continue;
    const name = uniqueName(parameters, componentName(group.parameter.name));
    parameters[name] = group.parameter;
    for (const slot of group.slots) {
      slot.list[slot.index] = { $ref: `#/components/parameters/${name}` };
    }
  }

  return {
    ...doc,
    components: {
      ...doc.components,
      ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
      ...(Object.keys(responses).length > 0 ? { responses } : {}),
    },
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
