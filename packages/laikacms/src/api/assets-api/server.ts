import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';

import type { Asset, AssetCreate, AssetMetadata, AssetsRepository, AssetUpdate, FetchHints } from 'laikacms/assets';
import type { ErrorStatus, LaikaDone, LaikaResult } from 'laikacms/core';
import { BadRequestError, errorStatus, InternalError, LaikaError, LaikaStream, LaikaTask } from 'laikacms/core';

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
): Promise<LaikaResult<{ data: ReadonlyArray<A>, done: D }>> => {
  try {
    const r = await Effect.runPromise(Effect.result(LaikaStream.runCollect(stream)));
    if (Result.isFailure(r)) return Result.fail(r.failure);
    return Result.succeed({ data: r.success.data, done: r.success.done });
  } catch (err) {
    return Result.fail(toLaikaError(err));
  }
};
import type { FolderCreate } from 'laikacms/storage';
import type { JsonApiCollectionResponse, JsonApiResource, JsonApiResponse } from './jsonapi.js';
import {
  assetToJsonApi,
  assetUrlToJsonApi,
  assetVariationsToJsonApi,
  buildPaginationLinks,
  folderToJsonApi,
  parseIncludeQuery,
  parseMetaQuery,
  parsePaginationQuery,
  resourceToJsonApi,
} from './jsonapi.js';

// ============================================
// Types
// ============================================

export interface AssetsApi {
  fetch(req: Request): Promise<Response>;
}

export interface AssetsApiOptions {
  repository: AssetsRepository;
  basePath?: string;
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

function respondError(error: LaikaError, status: ErrorStatus = 400): Response {
  return json(
    {
      errors: [{
        status: String(status),
        code: error.code,
        detail: error.message,
      }],
    },
    status,
  );
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
): Response {
  const response: JsonApiResponse = { data: withAssetsSelfLink(resource, basePath) };
  if (included && included.length > 0) {
    response.included = included;
  }
  return json(response);
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
  const { repository, basePath = '/api/assets' } = options;

  // Create decoders
  const decodeAssetCreate = S.decodeUnknownSync(JsonApiAssetCreateSchema);
  const decodeAssetUpdate = S.decodeUnknownSync(JsonApiAssetUpdateSchema);
  const decodeFolderCreate = S.decodeUnknownSync(JsonApiFolderCreateSchema);

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      // Parse query parameters
      const query: Record<string, string | undefined> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });

      // `?include=` only carries actual relationships (urls, variations) per
      // the JSON:API spec. Intrinsic metadata is opted into separately via
      // `?meta=true`, because it's not a related resource — it's a property
      // of the asset that arrives on `data.meta`.
      const includeHints = parseIncludeQuery(query['include']);
      const metaHint = parseMetaQuery(query['meta']);
      const hints: FetchHints = {
        metadata: metaHint.metadata,
        urls: includeHints.urls,
        variations: includeHints.variations,
      };

      // Route: GET /capabilities
      // Surface the underlying assets repository's `Capabilities` so the
      // proxy client can introspect what the upstream actually supports
      // instead of guessing.
      if (path === `${basePath}/capabilities` && method === 'GET') {
        const result = await firstResult(repository.getCapabilities());
        if (Result.isFailure(result)) {
          return respondError(result.failure, errorStatus.INTERNAL_ERROR);
        }
        return respondResource({
          type: 'assets-capabilities',
          id: 'self',
          attributes: result.success,
          links: { self: `${basePath}/capabilities` },
        });
      }

      // Route: GET /resources
      // List all resources in a folder
      if (path === `${basePath}/resources` && method === 'GET') {
        const folderKey = query['folder'] || query['filter[prefix]'] || '';
        const pagination = parsePaginationQuery(query);

        // Parse depth parameter (minimum 1)
        const depthParam = query['filter[depth]'] || query['depth'];
        const depth = depthParam ? Math.max(1, parseInt(depthParam, 10) || 1) : 1;

        // Use offset-based pagination which has limit
        const paginationOptions = {
          offset: 0,
          limit: pagination.limit || 100,
        };

        const included: JsonApiResource[] = [];
        let hasMore = false;
        let nextCursor: string | undefined;

        const batch = await runStreamWithDone(
          repository.listResources(folderKey, {
            pagination: paginationOptions,
            depth,
            hints,
          }),
        );
        if (Result.isFailure(batch)) {
          return respondError(batch.failure, errorStatus.BAD_REQUEST);
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

        if (batchData.length >= paginationOptions.limit) {
          hasMore = true;
          nextCursor = batchData[batchData.length - 1]?.key;
        }

        const links = buildPaginationLinks(
          url.toString(),
          pagination,
          hasMore,
          nextCursor,
          pagination.cursor,
        );

        // Navigation lives in `links` per JSON:API §8 — `hasMore` is
        // implicit in the presence of `links.next`, and the current cursor
        // is encoded in the request URL itself. `meta.page` only carries
        // aggregate counts the backend supplies.
        const meta: Record<string, unknown> | undefined = typeof batchDone.total === 'number'
          ? { page: { total: batchDone.total } }
          : undefined;

        return respondCollection(resources, included, links, meta, basePath);
      }

      // Route: GET /resources/:key
      // Get a single resource by key
      if (path.startsWith(`${basePath}/resources/`) && method === 'GET') {
        const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));

        const result = await firstResult(repository.getResource(key, { hints }));
        if (Result.isFailure(result)) {
          return respondError(result.failure, errorStatus.NOT_FOUND);
        }
        const resourceData = result.success[0];
        if (!resourceData) {
          return respondError(new BadRequestError('Resource not found'), errorStatus.NOT_FOUND);
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

        return respondResource(resource, included, basePath);
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

          const result = await firstResult(repository.createAsset({
            key: assetKey,
            mimeType,
            content,
            filename,
            customMetadata,
            cacheControl,
          }));
          if (Result.isFailure(result)) {
            return respondError(result.failure, errorStatus.BAD_REQUEST);
          }
          return respondResource(assetToJsonApi(result.success), undefined, basePath);
        }

        // Handle JSON:API request for folder creation
        if (contentType.includes('application/vnd.api+json') || contentType.includes('application/json')) {
          const body = await request.json() as { data: unknown };
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
            const result = await firstResult(repository.createFolder(folderCreate));
            if (Result.isFailure(result)) {
              return respondError(result.failure, errorStatus.BAD_REQUEST);
            }
            return respondResource(folderToJsonApi(result.success), undefined, basePath);
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

            const result = await firstResult(repository.createAsset(assetCreate));
            if (Result.isFailure(result)) {
              return respondError(result.failure, errorStatus.BAD_REQUEST);
            }
            return respondResource(assetToJsonApi(result.success), undefined, basePath);
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
        const body = await request.json() as { data: Record<string, unknown> };

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

        const result = await firstResult(repository.updateAsset(assetUpdate));
        if (Result.isFailure(result)) {
          return respondError(result.failure, errorStatus.BAD_REQUEST);
        }
        return respondResource(assetToJsonApi(result.success), undefined, basePath);
      }

      // Route: DELETE /resources/:key
      // Delete a resource
      if (path.startsWith(`${basePath}/resources/`) && method === 'DELETE') {
        const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));
        const recursive = query['recursive'] === 'true';

        // Try to determine if it's an asset or folder
        const resourceResult = await firstResult(repository.getResource(key));
        if (Result.isFailure(resourceResult)) {
          return respondError(resourceResult.failure, errorStatus.NOT_FOUND);
        }
        const firstResource = resourceResult.success[0];
        if (!firstResource) {
          return respondError(new BadRequestError('Resource not found'), errorStatus.NOT_FOUND);
        }
        const resourceType = firstResource.type;

        if (resourceType === 'folder') {
          const r = await firstResult(repository.deleteFolder(key, recursive));
          if (Result.isFailure(r)) {
            return respondError(r.failure, errorStatus.BAD_REQUEST);
          }
        } else {
          const r = await firstResult(repository.deleteAsset(key));
          if (Result.isFailure(r)) {
            return respondError(r.failure, errorStatus.BAD_REQUEST);
          }
        }

        return new Response(null, { status: 204 });
      }

      // 404 Not Found
      return json(
        {
          errors: [{
            status: '404',
            code: 'not_found',
            detail: `Route not found: ${method} ${path}`,
          }],
        },
        404,
      );
    },
  };
}
