/**
 * Slicing for the `read_api_spec` MCP tool.
 *
 * A combined Laika CMS contract (documents + storage + assets) is hundreds of
 * kilobytes of JSON. A model driving `api_request` needs three or four
 * operations, not all of them, so handing it the whole document spends most of
 * a context window on endpoints it will never call.
 *
 * So `read_api_spec` answers in two modes:
 *
 *  - no arguments -> a compact text INDEX (one line per operation, grouped by
 *    tag). Everything needed to pick the right endpoint, a fraction of the size.
 *  - `paths` / `tag` / `search` -> a real OpenAPI 3.1 document narrowed to the
 *    matching operations, with the transitive `$ref` closure resolved so the
 *    slice stays self-contained and valid.
 *
 * Protocol-agnostic on purpose (plain document in, string out) so it is
 * testable without the MCP SDK; the tool wiring lives in mcp-server.ts.
 */
import type { OpenApiDocument } from 'laikacms/json-api';

/** Filters accepted by `read_api_spec`. Combined with AND when more than one is given. */
export interface OpenApiSliceArgs {
  /** Paths to include, with or without the document's server base path. Prefix matches pull in sub-paths. */
  paths?: string[];
  /** Only operations carrying this tag. */
  tag?: string;
  /** Only operations whose path, summary, description or operationId contains this text. */
  search?: string;
}

// Internal structural view of an OpenAPI document. The slicer walks documents
// as loose records (it must survive anything a builder or a hand-authored spec
// throws at it); the public signatures speak the authored `OpenApiDocument`
// type from laikacms/json-api and cast once at the boundary.
interface SpecOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  [key: string]: unknown;
}

type SpecPathItem = Record<string, unknown>;

interface SpecDocument {
  openapi?: string;
  info?: { title?: string, version?: string, [key: string]: unknown };
  servers?: { url?: string, description?: string }[];
  tags?: { name?: string, description?: string }[];
  paths?: Record<string, SpecPathItem>;
  components?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

const asSpec = (document: OpenApiDocument): SpecDocument => document as unknown as SpecDocument;

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** Components kept in every slice regardless of what the operations reference. */
const ALWAYS_KEPT_COMPONENTS = ['securitySchemes'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const operationEntries = (item: SpecPathItem): [string, SpecOperation][] =>
  HTTP_METHODS
    .filter(method => isRecord(item[method]))
    .map(method => [method, item[method] as SpecOperation]);

/**
 * The path prefix `servers[0].url` puts in front of every operation — `/api`
 * for a document served under `laikaApi({ basePath: '/api' })`, `''` when the
 * API sits at the origin root. Callers quote paths with or without it.
 */
function serverPathPrefix(document: SpecDocument): string {
  const url = document.servers?.[0]?.url;
  if (typeof url !== 'string' || url.length === 0) return '';
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Relative server URL ('/api', '/') — already a pathname.
  }
  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Normalize a caller-supplied path for comparison. `api_request` takes
 * `${basePath}/documents/records` while the spec keys are server-relative
 * (`/documents/records`), and a model that half-remembers a parameter name
 * should still find the operation - so parameter names are erased too.
 */
function normalizePath(path: string, serverPrefix: string): string {
  const withoutServerPrefix = serverPrefix !== '' && (path === serverPrefix || path.startsWith(`${serverPrefix}/`))
    ? path.slice(serverPrefix.length)
    : path;
  const rooted = withoutServerPrefix.startsWith('/') ? withoutServerPrefix : `/${withoutServerPrefix}`;
  const trimmed = rooted.length > 1 ? rooted.replace(/\/+$/, '') : rooted;
  return trimmed.replace(/\{[^}]*\}/g, '{}');
}

/** True when `specPath` is the requested path or sits underneath it. */
function pathMatches(specPath: string, requested: string, serverPrefix: string): boolean {
  const spec = normalizePath(specPath, serverPrefix);
  const wanted = normalizePath(requested, serverPrefix);
  if (spec === wanted) return true;
  if (wanted === '/') return true;
  return spec.startsWith(`${wanted}/`);
}

function operationMatchesSearch(path: string, operation: SpecOperation, needle: string): boolean {
  const haystack = [path, operation.summary, operation.description, operation.operationId, ...operation.tags ?? []]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .toLowerCase();
  return haystack.includes(needle.toLowerCase());
}

/** Every `#/components/<section>/<name>` pointer reachable from `value`. */
function collectRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectRefs(entry, into);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === '$ref' && typeof entry === 'string') {
      if (entry.startsWith('#/components/')) into.add(entry);
      continue;
    }
    collectRefs(entry, into);
  }
}

/**
 * Resolve the transitive component closure of `roots`. A response referencing
 * `PublishedResource` which references `DocumentContent` must drag both along,
 * or the slice is a document with dangling `$ref`s - worse than no document at
 * all.
 */
function componentClosure(
  components: Record<string, Record<string, unknown>>,
  roots: Set<string>,
): Record<string, Record<string, unknown>> {
  const kept: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const pointer = queue.pop() as string;
    if (seen.has(pointer)) continue;
    seen.add(pointer);

    const [, , section, ...rest] = pointer.split('/');
    const name = rest.join('/');
    if (!section || !name) continue;
    const definition = components[section]?.[name];
    if (definition === undefined) continue;

    (kept[section] ??= {})[name] = definition;

    const nested = new Set<string>();
    collectRefs(definition, nested);
    for (const ref of nested) if (!seen.has(ref)) queue.push(ref);
  }

  for (const section of ALWAYS_KEPT_COMPONENTS) {
    const whole = components[section];
    if (whole) kept[section] = { ...whole, ...kept[section] };
  }

  return kept;
}

/**
 * Compact operation listing, grouped by tag. This is what a model reads first:
 * enough to choose an endpoint, small enough to never be the reason a context
 * window fills up.
 */
export function buildSpecIndex(source: OpenApiDocument): string {
  const document = asSpec(source);
  const paths = document.paths ?? {};
  const byTag = new Map<string, string[]>();
  let operationCount = 0;

  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue;
    for (const [method, operation] of operationEntries(item)) {
      operationCount += 1;
      const summary = operation.summary ?? operation.description?.split('\n')[0] ?? '';
      const deprecated = operation.deprecated === true ? ' [deprecated]' : '';
      const line = `${method.toUpperCase().padEnd(6)} ${path}${summary ? ` - ${summary}` : ''}${deprecated}`;
      for (const tag of operation.tags?.length ? operation.tags : ['(untagged)']) {
        const group = byTag.get(tag) ?? [];
        group.push(line);
        byTag.set(tag, group);
      }
    }
  }

  const title = document.info?.title ?? 'API';
  const version = document.info?.version ?? '';
  const server = document.servers?.[0]?.url ?? '';

  const lines = [
    `${title}${version ? ` ${version}` : ''} - OpenAPI ${document.openapi ?? '3.1'} INDEX`,
    `${Object.keys(paths).length} paths, ${operationCount} operations${server ? `, base ${server}` : ''}`,
    '',
    'This is an index, not the contract: parameters, request bodies and response schemas are omitted.',
    'Call read_api_spec again with the operations you need to get the full schema for them, e.g.',
    '  {"paths": ["/documents/records", "/documents/published/{key}"]}   (prefix matches include sub-paths)',
    '  {"tag": "documents/published"}',
    '  {"search": "revision"}',
    '',
  ];

  for (const [tag, entries] of byTag) {
    lines.push(`## ${tag}`, ...entries.sort(), '');
  }

  return lines.join('\n').trimEnd();
}

export interface OpenApiSliceResult {
  /** The narrowed document, or null when nothing matched. */
  document: OpenApiDocument | null;
  /** Spec paths that survived the filters. */
  matchedPaths: string[];
  /** Requested paths that matched nothing - surfaced so the model can retry rather than assume a 404. */
  unmatchedRequests: string[];
}

/**
 * Narrow `source` to the operations selected by `args`, keeping it a valid,
 * self-contained OpenAPI document.
 */
export function sliceOpenApiDocument(source: OpenApiDocument, args: OpenApiSliceArgs): OpenApiSliceResult {
  const document = asSpec(source);
  const serverPrefix = serverPathPrefix(document);
  const requestedPaths = (args.paths ?? []).filter(path => typeof path === 'string' && path.length > 0);
  const slicedPaths: Record<string, SpecPathItem> = {};
  const usedRequests = new Set<string>();

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (!isRecord(item)) continue;

    if (requestedPaths.length > 0) {
      const hits = requestedPaths.filter(requested => pathMatches(path, requested, serverPrefix));
      if (hits.length === 0) continue;
      for (const hit of hits) usedRequests.add(hit);
    }

    // Shared path-level keys (`parameters`, `summary`, ...) ride along with
    // whichever operations survive.
    const shared = Object.fromEntries(
      Object.entries(item).filter(([key]) => !(HTTP_METHODS as readonly string[]).includes(key)),
    );
    const operations = operationEntries(item).filter(([, operation]) => {
      if (args.tag && !(operation.tags ?? []).includes(args.tag)) return false;
      if (args.search && !operationMatchesSearch(path, operation, args.search)) return false;
      return true;
    });
    if (operations.length === 0) continue;

    slicedPaths[path] = { ...shared, ...Object.fromEntries(operations) };
  }

  const matchedPaths = Object.keys(slicedPaths);
  if (matchedPaths.length === 0) {
    return { document: null, matchedPaths: [], unmatchedRequests: requestedPaths };
  }

  const refs = new Set<string>();
  collectRefs(slicedPaths, refs);
  const components = componentClosure(document.components ?? {}, refs);

  const usedTags = new Set(
    matchedPaths.flatMap(path =>
      operationEntries(slicedPaths[path] as SpecPathItem).flatMap(([, op]) => op.tags ?? [])
    ),
  );

  const sliced: SpecDocument = {
    ...(document.openapi ? { openapi: document.openapi } : {}),
    ...(document.info ? { info: document.info } : {}),
    ...(document.servers ? { servers: document.servers } : {}),
    ...(document.tags ? { tags: document.tags.filter(tag => tag.name && usedTags.has(tag.name)) } : {}),
    paths: slicedPaths,
    components,
  };

  return {
    document: sliced as unknown as OpenApiDocument,
    matchedPaths,
    unmatchedRequests: requestedPaths.filter(requested => !usedRequests.has(requested)),
  };
}

/** Does this call want a slice, or the index? */
export function hasSliceFilter(args: OpenApiSliceArgs): boolean {
  return Boolean(args.tag || args.search || (args.paths?.length ?? 0) > 0);
}

/**
 * Full `read_api_spec` answer: index when unfiltered, sliced document
 * otherwise. `x-slice` records what was left out, so a model that filtered too
 * narrowly can tell the difference between "not in the API" and "not in this
 * slice".
 */
export function readApiSpec(document: OpenApiDocument, args: OpenApiSliceArgs = {}): string {
  if (!hasSliceFilter(args)) return buildSpecIndex(document);

  const { document: sliced, matchedPaths, unmatchedRequests } = sliceOpenApiDocument(document, args);
  const totalPaths = Object.keys(asSpec(document).paths ?? {}).length;

  if (!sliced) {
    return [
      'No operation matched that filter.',
      unmatchedRequests.length > 0 ? `Unmatched paths: ${unmatchedRequests.join(', ')}` : '',
      '',
      'Call read_api_spec with no arguments for the full operation index.',
    ].filter(Boolean).join('\n');
  }

  return JSON.stringify({
    ...sliced,
    'x-slice': {
      note: `Sliced from the full contract: ${matchedPaths.length} of ${totalPaths} paths. Call read_api_spec with no `
        + 'arguments for the index of everything else.',
      filter: args,
      ...(unmatchedRequests.length > 0 ? { unmatchedRequests } : {}),
    },
  });
}
