import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';

import type { Asset, AssetCreate, AssetMetadata, AssetsRepository, AssetUpdate, FetchHints } from 'laikacms/assets';
import type { ErrorStatus, LaikaDone, LaikaResult } from 'laikacms/core';
import {
  BadRequestError,
  ErrorCodeToStatusMap,
  errorStatus,
  InternalError,
  InvalidData,
  LaikaError,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type { JsonApiLogger } from 'laikacms/json-api';
import { errorToJsonApiMapper, recoverableErrorsToWarnings } from 'laikacms/json-api';

/** Convert any caught throw into a LaikaError, preserving LaikaError instances and wrapping defects in InternalError. */
const toLaikaError = (err: unknown): LaikaError => {
  if (err instanceof LaikaError) return err;
  if (err instanceof Error) return new InternalError(err.message, { cause: err });
  return new InternalError(String(err));
};

/**
 * Run a LaikaTask and surface the resolved value as a LaikaResult. Catches
 * both typed failures AND defects so route handlers always produce a
 * JSON:API response instead of leaking text/plain 500s.
 */
const firstResultWithMetadata = async <T>(
  task: LaikaTask.LaikaTask<T>,
): Promise<LaikaResult<{ value: T, recoverableErrors: ReadonlyArray<LaikaError> }>> => {
  try {
    const r = await Effect.runPromise(Effect.result(LaikaTask.runCollect(task)));
    if (Result.isFailure(r)) return Result.fail(r.failure);
    return Result.succeed({ value: r.success.value, recoverableErrors: r.success.recoverableErrors });
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
};

const firstResult = async <T>(task: LaikaTask.LaikaTask<T>): Promise<LaikaResult<T>> => {
  try {
    return await Effect.runPromise(Effect.result(LaikaTask.runValue(task)));
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
};

/** Run a LaikaStream and collect data into a Result of the flat array. Catches defects, same as {@link firstResult}. */
const runStream = async <A, D extends LaikaDone>(
  stream: LaikaStream.LaikaStream<A, D>,
): Promise<LaikaResult<ReadonlyArray<A>>> => {
  try {
    const r = await Effect.runPromise(Effect.result(LaikaStream.runCollect(stream)));
    if (Result.isFailure(r)) return Result.fail(r.failure);
    return Result.succeed(r.success.data);
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
};

/**
 * Like `runStream` but preserves the stream's terminal `Done` value (which
 * carries pagination metadata like `total`). Used by the list endpoint to
 * surface `meta.page.total` on the JSON:API response.
 */
const runStreamWithDone = async <A, D extends LaikaDone>(
  stream: LaikaStream.LaikaStream<A, D>,
): Promise<
  LaikaResult<{
    data: ReadonlyArray<A>,
    done: D,
    recoverableErrors: ReadonlyArray<LaikaError>,
  }>
> => {
  try {
    const r = await Effect.runPromise(Effect.result(LaikaStream.runCollect(stream)));
    if (Result.isFailure(r)) return Result.fail(r.failure);
    return Result.succeed({
      data: r.success.data,
      done: r.success.done,
      recoverableErrors: r.success.recoverableErrors,
    });
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
};
import { buildPaginationLinks, parsePaginationQuery } from 'laikacms/json-api';
import { openApiDocumentToYaml } from 'laikacms/json-api';
import type { FolderCreate } from 'laikacms/storage';
import { SyncToken } from 'laikacms/storage';
import type { JsonApiCollectionResponse, JsonApiResource, JsonApiResponse } from './jsonapi.js';
import {
  assetToJsonApi,
  assetUrlToJsonApi,
  assetVariationsToJsonApi,
  folderToJsonApi,
  parseIncludeQuery,
  parseMetaQuery,
  resourceToJsonApi,
} from './jsonapi.js';
import { buildAssetsOpenApi } from './openapi.js';

// ============================================
// Types
// ============================================

/**
 * `filter[...]` keys with structural meaning (folder/prefix scope the
 * listing, depth bounds the traversal, since drives /changes). Every other
 * `filter[<name>]` is a repository-declared listing filter and is forwarded
 * generically after validation against `getCapabilities().filtering`.
 */
const RESERVED_FILTER_KEYS = new Set(['folder', 'prefix', 'depth', 'since']);

export interface AssetsApi {
  fetch(req: Request): Promise<Response>;
}

export interface AssetsApiOptions {
  repository: AssetsRepository;
  basePath?: string;
  onError?: (error: unknown) => void;
  logger?: JsonApiLogger;
}

// ============================================
// Response Helpers
// ============================================

const json = <T>(
  data: T,
  status: number = 200,
  headers: Record<string, string> = {},
): Response => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/vnd.api+json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
};

function respondError(error: LaikaError, status: ErrorStatus = 400, logger?: JsonApiLogger): Response {
  return json(errorToJsonApiMapper(error, logger), status);
}

function respondValidationError(errors: Array<{ message: string }>, status: ErrorStatus = 400): Response {
  return json(
    {
      errors: errors.map(e => ({
        status: String(status),
        code: 'validation_error',
        detail: e.message,
      })),
    },
    status,
  );
}

/**
 * Map an assets-api resource `type` to its canonical detail URL relative to
 * `basePath`. Decorating responders with `links.self` per JSON:API spec lets
 * clients navigate from collection items to detail without knowing the
 * route table.
 */
const assetsSelfPathFor = (basePath: string, type: string, id: string): string | undefined => {
  const encoded = encodeURIComponent(id);
  switch (type) {
    case 'asset':
    case 'folder':
      return `${basePath}/resources/${encoded}`;
    case 'asset-url':
    case 'asset-variation':
      // No standalone GET; these only appear under `included`. Skip self-link.
      return undefined;
    case 'assets-capabilities':
      return `${basePath}/capabilities`;
    case 'sync-token':
      return `${basePath}/sync-token`;
    default:
      return undefined;
  }
};

const withAssetsSelfLink = (resource: JsonApiResource, basePath: string): JsonApiResource => {
  const path = assetsSelfPathFor(basePath, resource.type, resource.id);
  if (!path) return resource;
  return { ...resource, links: { ...(resource.links ?? {}), self: path } };
};

function respondResource(
  resource: JsonApiResource,
  included?: JsonApiResource[],
  basePath: string = '',
  recoverableErrors?: ReadonlyArray<LaikaError>,
  status: number = 200,
): Response {
  const response: JsonApiResponse = { data: withAssetsSelfLink(resource, basePath) };
  if (included && included.length > 0) {
    response.included = included;
  }
  const warnings = recoverableErrors ? recoverableErrorsToWarnings(recoverableErrors) : undefined;
  if (warnings) {
    response.meta = { warnings };
  }
  return json(response, status);
}

function respondCollection(
  resources: JsonApiResource[],
  included?: JsonApiResource[],
  links?: Record<string, string | null>,
  meta?: Record<string, unknown>,
  basePath: string = '',
): Response {
  const response: JsonApiCollectionResponse = {
    data: resources.map(r => withAssetsSelfLink(r, basePath)),
  };
  if (included && included.length > 0) {
    response.included = included;
  }
  if (links) {
    response.links = links;
  }
  if (meta) {
    response.meta = meta;
  }
  return json(response);
}

// ============================================
// Effect Schema Definitions for JSON:API Request Validation
// ============================================

const JsonApiAssetCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('asset'),
  id: S.String,
  attributes: S.Struct({
    mimeType: S.optional(S.String),
    filename: S.optional(S.String),
    cacheControl: S.optional(S.String),
    customMetadata: S.optional(S.Record(S.String, S.String)),
    content: S.optional(S.String), // base64 encoded content
  }),
}));

const JsonApiAssetUpdateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('asset'),
  id: S.String,
  attributes: S.Struct({
    mimeType: S.optional(S.String),
    cacheControl: S.optional(S.String),
    customMetadata: S.optional(S.Record(S.String, S.String)),
  }),
}));

const JsonApiFolderCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('folder'),
  id: S.String,
  attributes: S.Struct({
    type: S.optional(S.Literal('folder')),
  }),
}));

type JsonApiAssetCreateData = S.Schema.Type<typeof JsonApiAssetCreateSchema>;
type JsonApiAssetUpdateData = S.Schema.Type<typeof JsonApiAssetUpdateSchema>;
type JsonApiFolderCreateData = S.Schema.Type<typeof JsonApiFolderCreateSchema>;

// ============================================
// Server Builder
// ============================================

/**
 * Build a JSON:API handler for the assets repository.
 *
 * ⚠️ This handler ships **no authentication**. Wrap it (e.g. with
 * `laikacms/decap-api` or a custom middleware that validates a Bearer token)
 * before exposing it to an untrusted network — otherwise anyone who can reach
 * `fetch` can list, upload, modify, and delete asset binaries.
 */
export function buildAssetsApi(options: AssetsApiOptions): AssetsApi {
  const { repository, basePath = '/api/assets', onError, logger } = options;

  // Create decoders
  const decodeAssetCreate = S.decodeUnknownSync(JsonApiAssetCreateSchema);
  const decodeAssetUpdate = S.decodeUnknownSync(JsonApiAssetUpdateSchema);
  const decodeFolderCreate = S.decodeUnknownSync(JsonApiFolderCreateSchema);

  return {
    async fetch(request: Request): Promise<Response> {
      try {
        return await fetchInner(request);
      } catch (err) {
        onError?.(err);
        return respondError(toLaikaError(err), 500, logger);
      }
    },
  };

  async function fetchInner(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // Parse query parameters — typed as string | string[] | undefined so the
    // shared parsePaginationQuery (which handles array values for repeated
    // params) accepts the map directly. Single-value params are cast inline.
    const query: Record<string, string | string[] | undefined> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const str = (v: string | string[] | undefined): string | undefined => Array.isArray(v) ? v[0] : v;

    // `?include=` only carries actual relationships (urls, variations) per
    // the JSON:API spec. Intrinsic metadata is opted into separately via
    // `?meta=true`, because it's not a related resource — it's a property
    // of the asset that arrives on `data.meta`.
    const includeHints = parseIncludeQuery(str(query['include']));
    const metaHint = parseMetaQuery(str(query['meta']));
    const hints: FetchHints = {
      metadata: metaHint.metadata,
      urls: includeHints.urls,
      variations: includeHints.variations,
    };

    // Route: GET / (api-info root)
    // Self-describing resource listing available endpoints, mirroring the
    // documents/storage sub-API roots so a client can discover routes uniformly.
    if ((path === basePath || path === `${basePath}/`) && method === 'GET') {
      return json({
        data: {
          type: 'api-info',
          id: 'assets',
          attributes: {
            name: 'Assets API',
            version: '1.0.0',
            endpoints: [
              { path: '/openapi.json', methods: ['GET'], description: 'OpenAPI 3.1 specification for this API' },
              {
                path: '/openapi.yaml',
                methods: ['GET'],
                description: 'OpenAPI 3.1 specification for this API, as YAML',
              },
              { path: '/capabilities', methods: ['GET'], description: 'Underlying assets repository capabilities' },
              { path: '/sync-token', methods: ['GET'], description: 'Get an opaque change token (capability-gated)' },
              { path: '/changes', methods: ['GET'], description: 'List changes since a sync token (capability-gated)' },
              { path: '/resources', methods: ['GET', 'POST'], description: 'List or create assets and folders' },
              {
                path: '/resources/{key}',
                methods: ['GET', 'PATCH', 'DELETE'],
                description: 'Read, update, or delete a resource',
              },
            ],
          },
        },
      });
    }

    // Route: GET /openapi.json
    // Serve the machine-readable API description with `servers` rewritten to
    // the absolute mount point so the document is usable as-is by clients.
    if (path === `${basePath}/openapi.json` && method === 'GET') {
      const doc = buildAssetsOpenApi({ basePath });
      return new Response(
        JSON.stringify({ ...doc, servers: [{ url: `${url.origin}${basePath}` }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Route: GET /openapi.yaml
    // Same document as /openapi.json, serialized as YAML for tooling that
    // prefers it (and for readable diffs).
    if (path === `${basePath}/openapi.yaml` && method === 'GET') {
      const doc = buildAssetsOpenApi({ basePath });
      const yaml = openApiDocumentToYaml({ ...doc, servers: [{ url: `${url.origin}${basePath}` }] });
      return new Response(yaml, {
        status: 200,
        headers: { 'Content-Type': 'application/yaml' },
      });
    }

    // Route: GET /capabilities
    // Surface the underlying assets repository's `Capabilities` so the
    // proxy client can introspect what the upstream actually supports
    // instead of guessing.
    if (path === `${basePath}/capabilities` && method === 'GET') {
      const result = await firstResult(repository.getCapabilities());
      if (Result.isFailure(result)) {
        const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
        return respondError(result.failure, status, logger);
      }
      return respondResource({
        type: 'assets-capabilities',
        id: 'self',
        attributes: result.success,
        links: { self: `${basePath}/capabilities` },
      });
    }

    // Route: GET /sync-token
    // Capability-gated: repositories that don't support change signals fail
    // with NotImplementedError, which maps to HTTP 501 and re-hydrates into
    // the same typed error on the proxy side.
    if (path === `${basePath}/sync-token` && method === 'GET') {
      const folder = str(query['filter[folder]']);
      const result = await firstResultWithMetadata(repository.getSyncToken(folder ? { folder } : undefined));
      if (Result.isFailure(result)) {
        const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
        return respondError(result.failure, status, logger);
      }
      return respondResource(
        {
          type: 'sync-token',
          id: folder ?? 'self',
          attributes: { syncToken: result.success.value as string, ...(folder ? { folder } : {}) },
        },
        undefined,
        basePath,
        result.success.recoverableErrors,
      );
    }

    // Route: GET /changes
    // List changes since a sync token; `meta.syncToken` carries the new token.
    if (path === `${basePath}/changes` && method === 'GET') {
      const since = str(query['filter[since]']);
      if (!since) {
        return respondError(
          new BadRequestError('filter[since] is required: pass a sync token obtained from GET /sync-token'),
          errorStatus.BAD_REQUEST,
        );
      }
      const folder = str(query['filter[folder]']);
      const batch = await runStreamWithDone(
        repository.listChanges({ since: SyncToken.make(since), ...(folder ? { folder } : {}) }),
      );
      if (Result.isFailure(batch)) {
        const status = ErrorCodeToStatusMap[batch.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
        return respondError(batch.failure, status, logger);
      }
      const resources: JsonApiResource[] = batch.success.data.map(change => ({
        type: 'change-summary',
        id: change.key,
        attributes: {
          deleted: change.deleted,
          ...(change.version !== undefined ? { version: change.version } : {}),
        },
      }));
      const done = batch.success.done;
      const warnings = recoverableErrorsToWarnings(batch.success.recoverableErrors);
      const meta: Record<string, unknown> = {
        ...(typeof done.total === 'number' ? { page: { total: done.total } } : {}),
        syncToken: done.syncToken as string,
        ...(warnings ? { warnings } : {}),
      };
      return respondCollection(resources, undefined, undefined, meta, basePath);
    }

    // Route: GET /resources
    // List all resources in a folder
    if (path === `${basePath}/resources` && method === 'GET') {
      const folderKey = str(query['folder']) || str(query['filter[folder]']) || str(query['filter[prefix]']) || '';
      const pagination = parsePaginationQuery(query);

      // Reject cursor params when the backend has declared cursor:false.
      // Mirrors storage-api's rejectUnsupportedCursor guard. When getCapabilities
      // fails we cannot verify support, so we let the list proceed (fail-open).
      if (str(query['page[after]']) !== undefined || str(query['page[before]']) !== undefined) {
        const capsResult = await firstResult(repository.getCapabilities());
        if (Result.isSuccess(capsResult)) {
          const caps = capsResult.success;
          const cursorSupported = caps.pagination.supported && caps.pagination.styles.cursor;
          if (!cursorSupported) {
            return respondError(
              new InvalidData(
                'Cursor pagination (page[after] / page[before]) is not supported by this assets backend. '
                  + 'Use page[size] (offset-based) instead. '
                  + 'Consult GET /capabilities for the pagination modes this backend supports.',
              ),
              400,
            );
          }
        }
      }

      // Parse depth parameter (minimum 1)
      const depthParam = str(query['filter[depth]']) || str(query['depth']);
      const depth = depthParam ? Math.max(1, parseInt(depthParam, 10) || 1) : 1;

      // Generic filter forwarding: every `filter[<name>]` param that is not a
      // structural key (folder/prefix/depth are routing/traversal concerns
      // parsed above) is validated against the repository's declared
      // filtering capability and forwarded verbatim. The server needs no
      // changes when a repository adds a new filter — it only relays names
      // the repository has declared.
      const filters: Record<string, string> = {};
      for (const [paramKey, paramValue] of Object.entries(query)) {
        const match = /^filter\[(.+)\]$/.exec(paramKey);
        if (!match || RESERVED_FILTER_KEYS.has(match[1])) continue;
        const value = str(paramValue);
        if (value !== undefined) filters[match[1]] = value;
      }
      if (Object.keys(filters).length > 0) {
        // Mirrors the cursor guard above: reject undeclared filters with a
        // pointer to /capabilities; fail open when capabilities are
        // unavailable (the repository still fails loudly on undeclared
        // names, so a filtered listing is never quietly unfiltered).
        const capsResult = await firstResult(repository.getCapabilities());
        if (Result.isSuccess(capsResult)) {
          const filtering = capsResult.success.filtering;
          const declared = new Set(filtering?.supported ? filtering.filters.map(f => f.name) : []);
          const unsupported = Object.keys(filters).filter(name => !declared.has(name));
          if (unsupported.length > 0) {
            return respondError(
              new InvalidData(
                `Unsupported filter(s): ${unsupported.join(', ')}. `
                  + 'Consult GET /capabilities for the filters this assets backend supports.',
              ),
              400,
            );
          }
        }
      }

      // Build pagination options from the shared pagination union. Forward
      // cursor (`after`) maps directly; backward cursor (`before`) is treated
      // as forward from that point for repository calls that only support
      // `after`. Page-based and offset-based fall back to offset pagination.
      //
      // parsePaginationQuery now defaults to page-based (page: 1) for a bare
      // page[size]=N request (LCMS-277). We still read page[size] directly from
      // the query as a belt-and-suspenders guard for the perPage value, and
      // the paginationForLinks derivation below remains correct for all shapes.
      const afterCursor = 'after' in pagination ? pagination.after : undefined;
      const rawPageSize = str(query['page[size]']);
      const rawPageSizeNum = rawPageSize ? parseInt(rawPageSize, 10) : undefined;
      const perPage = rawPageSizeNum
        ?? ('perPage' in pagination ? pagination.perPage : undefined)
        ?? ('limit' in pagination ? pagination.limit : undefined)
        ?? 100;
      // Build a corrected pagination object that carries the real page size so
      // buildPaginationLinks emits the correct page[size] on next/prev links.
      const paginationForLinks = 'after' in pagination
        ? { after: pagination.after, perPage }
        : 'before' in pagination
        ? { before: (pagination as { before?: string }).before, perPage }
        : pagination;
      // Convert page-based pagination to offset for the backend call.
      // page[number]=N → offset=(N-1)*perPage so page advances correctly.
      // Cursor-shaped requests stay cursor-shaped even when `after` is still
      // undefined (start of a cursor iteration, requested as an empty
      // page[after]=): backends with native cursors must take their cursor
      // path from the first page or their next-page cursor never exists.
      const pageNum = 'page' in pagination && typeof pagination.page === 'number' ? pagination.page : undefined;
      const paginationOptions: { offset: number, limit: number } | { after: string | undefined, perPage: number } =
        'after' in pagination
          ? { after: afterCursor, perPage }
          : 'offset' in pagination
          ? { offset: pagination.offset, limit: perPage }
          : { offset: pageNum && pageNum > 1 ? (pageNum - 1) * perPage : 0, limit: perPage };

      const included: JsonApiResource[] = [];
      let hasMore = false;
      let nextCursor: string | undefined;

      const batch = await runStreamWithDone(
        repository.listResources(folderKey, {
          pagination: paginationOptions,
          depth,
          hints,
          ...(Object.keys(filters).length > 0 ? { filters } : {}),
        }),
      );
      if (Result.isFailure(batch)) {
        const status = ErrorCodeToStatusMap[batch.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
        return respondError(batch.failure, status, logger);
      }
      const batchData = batch.success.data;
      const batchDone = batch.success.done;
      const assets = batchData.filter((r): r is Asset => r.type === 'asset');

      // Fetch metadata up front so we can inline it onto each asset's `meta`.
      const metadataByKey = new Map<string, AssetMetadata['metadata']>();
      if (hints.metadata) {
        const metas = await runStream(repository.getMetadata(assets));
        if (Result.isSuccess(metas)) {
          for (const m of metas.success) metadataByKey.set(m.key, m.metadata);
        }
      }
      if (hints.urls) {
        const urls = await runStream(repository.getUrls(assets));
        if (Result.isSuccess(urls)) {
          for (const u of urls.success) included.push(assetUrlToJsonApi(u));
        }
      }
      if (hints.variations) {
        const variations = await runStream(repository.getVariations(assets));
        if (Result.isSuccess(variations)) {
          for (const v of variations.success) included.push(assetVariationsToJsonApi(v));
        }
      }
      const resources: JsonApiResource[] = batchData.map(r =>
        resourceToJsonApi(r, {
          metadata: r.type === 'asset' ? metadataByKey.get(r.key) : undefined,
          advertiseRelationships: { urls: hints.urls, variations: hints.variations },
        })
      );

      // Prefer the repository's own done.pagination: a repo with native
      // cursors (e.g. R2) returns the exact opaque cursor for the next page,
      // and its absence on a cursor-style request authoritatively means the
      // listing is exhausted (last-key heuristics would fabricate a cursor
      // the backend cannot resolve). The length heuristic remains for
      // offset/page requests against repos that never populate
      // done.pagination.
      const effectivePageSize = 'limit' in paginationOptions ? paginationOptions.limit : paginationOptions.perPage;
      const donePagination = batchDone.pagination;
      if (donePagination && 'after' in donePagination && donePagination.after !== undefined) {
        hasMore = true;
        nextCursor = donePagination.after;
      } else if (!('after' in paginationOptions) && batchData.length >= effectivePageSize) {
        hasMore = true;
        nextCursor = batchData[batchData.length - 1]?.key;
      }

      // firstCursor is the key of the first item in the current page; it is
      // used by the shared buildPaginationLinks to build the prev link when
      // navigating forward (page[after] is set).
      //
      // buildPaginationLinks expects a clean base URL (no query string) — it
      // builds the full query string itself from the pagination object.
      const resourcesBaseUrl = `${url.origin}${url.pathname}`;
      const firstCursor = batchData[0]?.key;
      const links = buildPaginationLinks(
        resourcesBaseUrl,
        paginationForLinks,
        hasMore,
        undefined,
        firstCursor,
        nextCursor,
      );

      // `meta.page` carries aggregate counts; `meta.warnings` carries
      // per-item recoverable errors collected during the walk (an
      // unreadable subfolder, a missing variation, etc.).
      const warnings = recoverableErrorsToWarnings(batch.success.recoverableErrors);
      const page = typeof batchDone.total === 'number' ? { total: batchDone.total } : undefined;
      const meta: Record<string, unknown> | undefined = page || warnings
        ? { ...(page ? { page } : {}), ...(warnings ? { warnings } : {}) }
        : undefined;

      return respondCollection(resources, included, links, meta, basePath);
    }

    // Route: GET /resources/:key
    // Get a single resource by key
    if (path.startsWith(`${basePath}/resources/`) && method === 'GET') {
      const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));

      const result = await firstResultWithMetadata(repository.getResource(key, { hints }));
      if (Result.isFailure(result)) {
        const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
        return respondError(result.failure, status, logger);
      }
      const resourceData = result.success.value[0];
      if (!resourceData) {
        return respondError(new NotFoundError('Resource not found'), errorStatus.NOT_FOUND);
      }

      const included: JsonApiResource[] = [];
      let inlineMetadata: AssetMetadata['metadata'] | undefined;

      if (resourceData.type === 'asset') {
        if (hints.metadata) {
          const metas = await runStream(repository.getMetadata([resourceData]));
          if (Result.isSuccess(metas) && metas.success[0]) {
            inlineMetadata = metas.success[0].metadata;
          }
        }
        if (hints.urls) {
          const urls = await runStream(repository.getUrls([resourceData]));
          if (Result.isSuccess(urls) && urls.success[0]) {
            included.push(assetUrlToJsonApi(urls.success[0]));
          }
        }
        if (hints.variations) {
          const variations = await runStream(repository.getVariations([resourceData]));
          if (Result.isSuccess(variations) && variations.success[0]) {
            included.push(assetVariationsToJsonApi(variations.success[0]));
          }
        }
      }

      const resource = resourceToJsonApi(resourceData, {
        metadata: inlineMetadata,
        advertiseRelationships: { urls: hints.urls, variations: hints.variations },
      });

      return respondResource(resource, included, basePath, result.success.recoverableErrors);
    }

    // Route: POST /resources
    // Create a new resource (asset or folder)
    if (path === `${basePath}/resources` && method === 'POST') {
      const contentType = request.headers.get('Content-Type') || '';

      // Handle multipart form data for asset uploads
      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const metadataJson = formData.get('metadata') as string | null;

        // Also check for individual form fields (alternative to metadata JSON)
        const keyField = formData.get('key') as string | null;
        const mimeTypeField = formData.get('mimeType') as string | null;
        const filenameField = formData.get('filename') as string | null;
        const cacheControlField = formData.get('cacheControl') as string | null;
        const customMetadataField = formData.get('customMetadata') as string | null;

        if (!file) {
          return respondError(
            new BadRequestError('Missing file in multipart form data'),
            errorStatus.BAD_REQUEST,
          );
        }

        let metadata: {
          key?: string,
          mimeType?: string,
          filename?: string,
          customMetadata?: Record<string, string>,
          cacheControl?: string,
        } | undefined;
        if (metadataJson) {
          try {
            metadata = JSON.parse(metadataJson);
          } catch {
            return respondError(
              new BadRequestError('Invalid metadata JSON'),
              errorStatus.BAD_REQUEST,
            );
          }
        }

        // Parse customMetadata from individual field if provided
        let customMetadata: Record<string, string> | undefined = metadata?.customMetadata;
        if (customMetadataField) {
          try {
            customMetadata = JSON.parse(customMetadataField);
          } catch {
            // Ignore invalid JSON
          }
        }

        // Priority: individual fields > metadata JSON > file properties
        const assetKey = keyField || metadata?.key || file.name;
        const mimeType = mimeTypeField || metadata?.mimeType || file.type || 'application/octet-stream';
        const filename = filenameField || metadata?.filename || file.name;
        const cacheControl = cacheControlField || metadata?.cacheControl;
        const content = await file.arrayBuffer();

        const result = await firstResultWithMetadata(repository.createAsset({
          key: assetKey,
          mimeType,
          content,
          filename,
          customMetadata,
          cacheControl,
        }));
        if (Result.isFailure(result)) {
          const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
          return respondError(result.failure, status, logger);
        }
        return respondResource(
          assetToJsonApi(result.success.value),
          undefined,
          basePath,
          result.success.recoverableErrors,
          201,
        );
      }

      // Handle JSON:API request for folder creation
      if (contentType.includes('application/vnd.api+json') || contentType.includes('application/json')) {
        let body: { data: unknown };
        try {
          body = await request.json() as { data: unknown };
        } catch {
          return respondError(new InvalidData('Invalid request body'), errorStatus.BAD_REQUEST);
        }
        const data = body.data as { type?: string };

        if (data.type === 'folder') {
          let parsed: JsonApiFolderCreateData;
          try {
            parsed = decodeFolderCreate(data);
          } catch {
            return respondValidationError(
              [{ message: 'Invalid folder create data' }],
              errorStatus.BAD_REQUEST,
            );
          }

          const folderCreate: FolderCreate = {
            key: parsed.id,
            type: 'folder',
          };
          const result = await firstResultWithMetadata(repository.createFolder(folderCreate));
          if (Result.isFailure(result)) {
            const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
            return respondError(result.failure, status, logger);
          }
          return respondResource(
            folderToJsonApi(result.success.value),
            undefined,
            basePath,
            result.success.recoverableErrors,
            201,
          );
        }

        // Asset creation via JSON (content must be base64 encoded)
        if (data.type === 'asset') {
          let parsed: JsonApiAssetCreateData;
          try {
            parsed = decodeAssetCreate(data);
          } catch {
            return respondValidationError(
              [{ message: 'Invalid asset create data' }],
              errorStatus.BAD_REQUEST,
            );
          }

          // Get base64 content from attributes
          const base64Content = parsed.attributes.content;
          if (!base64Content) {
            return respondError(
              new BadRequestError('Missing content in asset creation. Use multipart/form-data for binary uploads.'),
              errorStatus.BAD_REQUEST,
            );
          }

          // Decode base64 to ArrayBuffer
          const binaryString = atob(base64Content);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const assetCreate: AssetCreate = {
            key: parsed.id,
            mimeType: parsed.attributes.mimeType || 'application/octet-stream',
            filename: parsed.attributes.filename,
            cacheControl: parsed.attributes.cacheControl,
            customMetadata: parsed.attributes.customMetadata,
            content: bytes.buffer,
          };

          const result = await firstResultWithMetadata(repository.createAsset(assetCreate));
          if (Result.isFailure(result)) {
            const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
            return respondError(result.failure, status, logger);
          }
          return respondResource(
            assetToJsonApi(result.success.value),
            undefined,
            basePath,
            result.success.recoverableErrors,
            201,
          );
        }

        return respondError(
          new BadRequestError('Invalid resource type. Must be "asset" or "folder".'),
          errorStatus.BAD_REQUEST,
        );
      }

      return respondError(
        new BadRequestError('Unsupported Content-Type. Use multipart/form-data or application/vnd.api+json.'),
        errorStatus.BAD_REQUEST,
      );
    }

    // Route: PATCH /resources/:key
    // Update an asset
    if (path.startsWith(`${basePath}/resources/`) && method === 'PATCH') {
      const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));
      let body: { data: Record<string, unknown> };
      try {
        body = await request.json() as { data: Record<string, unknown> };
      } catch {
        return respondError(new InvalidData('Invalid request body'), errorStatus.BAD_REQUEST);
      }

      // Add the key as id for validation
      const dataWithId = { ...body.data, id: key };
      let parsed: JsonApiAssetUpdateData;
      try {
        parsed = decodeAssetUpdate(dataWithId);
      } catch {
        return respondValidationError(
          [{ message: 'Invalid asset update data' }],
          errorStatus.BAD_REQUEST,
        );
      }

      const assetUpdate: AssetUpdate = {
        key: parsed.id,
        mimeType: parsed.attributes.mimeType,
        cacheControl: parsed.attributes.cacheControl,
        customMetadata: parsed.attributes.customMetadata,
      };

      const result = await firstResultWithMetadata(repository.updateAsset(assetUpdate));
      if (Result.isFailure(result)) {
        const status = ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
        return respondError(result.failure, status, logger);
      }
      return respondResource(
        assetToJsonApi(result.success.value),
        undefined,
        basePath,
        result.success.recoverableErrors,
      );
    }

    // Route: DELETE /resources/:key
    // Delete a resource
    if (path.startsWith(`${basePath}/resources/`) && method === 'DELETE') {
      const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));
      const recursive = str(query['recursive']) === 'true';

      // Try to determine if it's an asset or folder
      const resourceResult = await firstResult(repository.getResource(key));
      if (Result.isFailure(resourceResult)) {
        const status = ErrorCodeToStatusMap[resourceResult.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
        return respondError(resourceResult.failure, status, logger);
      }
      const firstResource = resourceResult.success[0];
      if (!firstResource) {
        return respondError(new NotFoundError('Resource not found'), errorStatus.NOT_FOUND);
      }
      const resourceType = firstResource.type;

      const deleteTask = resourceType === 'folder'
        ? repository.deleteFolder(key, recursive)
        : repository.deleteAsset(key);
      const r = await firstResultWithMetadata(deleteTask);
      if (Result.isFailure(r)) {
        const status = ErrorCodeToStatusMap[r.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500;
        return respondError(r.failure, status, logger);
      }
      // Clean success → 204 No Content (back-compat). Partial success with
      // recoverable warnings → 200 + a small body so the warnings can ride
      // along; HTTP 204 forbids a response body.
      const warnings = recoverableErrorsToWarnings(r.success.recoverableErrors);
      if (!warnings) {
        return new Response(null, { status: 204 });
      }
      return json({ meta: { deleted: true, warnings } });
    }

    // 404 Not Found — use the shared error formatter for envelope consistency with documents/storage.
    return respondError(new NotFoundError('Endpoint not found'), 404, logger);
  }
}
