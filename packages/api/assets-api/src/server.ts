import { Asset, AssetCreate, AssetsRepository, AssetUpdate, FetchHints } from '@laikacms/assets';
import { BadRequestError, ErrorStatus, errorStatus, LaikaError, LaikaResult } from '@laikacms/core';
import { Folder, FolderCreate } from '@laikacms/storage';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';
import {
  assetCreateFromJsonApi,
  assetMetadataToJsonApi,
  assetToJsonApi,
  assetUpdateFromJsonApi,
  assetUrlToJsonApi,
  assetVariationsToJsonApi,
  buildPaginationLinks,
  folderCreateFromJsonApi,
  folderToJsonApi,
  type JsonApiAssetCreate,
  type JsonApiAssetUpdate,
  JsonApiCollectionResponse,
  type JsonApiFolderCreate,
  JsonApiResource,
  JsonApiResponse,
  parseIncludeQuery,
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

function respondResource(
  resource: JsonApiResource,
  included?: JsonApiResource[],
): Response {
  const response: JsonApiResponse = { data: resource };
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
): Response {
  const response: JsonApiCollectionResponse = { data: resources };
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

      // Parse include parameter into FetchHints
      const includeHints = parseIncludeQuery(query['include']);
      const hints: FetchHints = {
        metadata: includeHints.metadata,
        urls: includeHints.urls,
        variations: includeHints.variations,
      };

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

        const resources: JsonApiResource[] = [];
        const included: JsonApiResource[] = [];
        let hasMore = false;
        let nextCursor: string | undefined;

        for await (
          const batch of repository.listResources(folderKey, {
            pagination: paginationOptions,
            depth,
            hints,
          })
        ) {
          if (Result.isFailure(batch)) {
            return respondError(batch.failure, errorStatus.BAD_REQUEST);
          }

          resources.push(...batch.success.map(resource => resourceToJsonApi(resource)));

          const assets = batch.success.filter((r): r is Asset => r.type === 'asset');

          for await (const metadataResult of repository.getMetadata(assets)) {
            if (Result.isSuccess(metadataResult)) {
              for (const metadata of metadataResult.success) {
                included.push(assetMetadataToJsonApi(metadata));
              }
            }
          }

          for await (const urlsResult of repository.getUrls(assets)) {
            if (Result.isSuccess(urlsResult)) {
              for (const urls of urlsResult.success) {
                included.push(assetUrlToJsonApi(urls));
              }
            }
          }

          for await (const variationsResult of repository.getVariations(assets)) {
            if (Result.isSuccess(variationsResult)) {
              for (const variations of variationsResult.success) {
                included.push(assetVariationsToJsonApi(variations));
              }
            }
          }

          // Check if there are more results
          if (batch.success.length >= paginationOptions.limit) {
            hasMore = true;
            nextCursor = batch.success[batch.success.length - 1]?.key;
          }
        }

        const links = buildPaginationLinks(
          url.toString(),
          pagination,
          hasMore,
          nextCursor,
          pagination.cursor,
        );

        return respondCollection(resources, included, links);
      }

      // Route: GET /resources/:key
      // Get a single resource by key
      if (path.startsWith(`${basePath}/resources/`) && method === 'GET') {
        const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));

        for await (const result of repository.getResource(key, { hints })) {
          if (Result.isFailure(result)) {
            return respondError(result.failure, errorStatus.NOT_FOUND);
          }

          const resourceData = result.success[0];
          if (!resourceData) {
            return respondError(new BadRequestError('Resource not found'), errorStatus.NOT_FOUND);
          }

          const resource = resourceToJsonApi(resourceData);
          const included: JsonApiResource[] = [];

          // Fetch included data for assets
          if (resourceData.type === 'asset') {
            if (hints.metadata) {
              for await (const metadataResult of repository.getMetadata([resourceData])) {
                if (Result.isSuccess(metadataResult)) {
                  included.push(assetMetadataToJsonApi(metadataResult.success[0]));
                }
              }
            }
            if (hints.urls) {
              for await (const urlsResult of repository.getUrls([resourceData])) {
                if (Result.isSuccess(urlsResult)) {
                  included.push(assetUrlToJsonApi(urlsResult.success[0]));
                }
              }
            }
            if (hints.variations) {
              for await (const variationsResult of repository.getVariations([resourceData])) {
                if (Result.isSuccess(variationsResult)) {
                  included.push(assetVariationsToJsonApi(variationsResult.success[0]));
                }
              }
            }
          }

          return respondResource(resource, included);
        }

        return respondError(new BadRequestError('Resource not found'), errorStatus.NOT_FOUND);
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

          for await (
            const result of repository.createAsset({
              key: assetKey,
              mimeType,
              content,
              filename,
              customMetadata,
              cacheControl,
            })
          ) {
            if (Result.isFailure(result)) {
              return respondError(result.failure, errorStatus.BAD_REQUEST);
            }
            return respondResource(assetToJsonApi(result.success));
          }
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
            for await (const result of repository.createFolder(folderCreate)) {
              if (Result.isFailure(result)) {
                return respondError(result.failure, errorStatus.BAD_REQUEST);
              }
              return respondResource(folderToJsonApi(result.success));
            }
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

            for await (const result of repository.createAsset(assetCreate)) {
              if (Result.isFailure(result)) {
                return respondError(result.failure, errorStatus.BAD_REQUEST);
              }
              return respondResource(assetToJsonApi(result.success));
            }
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

        for await (const result of repository.updateAsset(assetUpdate)) {
          if (Result.isFailure(result)) {
            return respondError(result.failure, errorStatus.BAD_REQUEST);
          }
          return respondResource(assetToJsonApi(result.success));
        }
      }

      // Route: DELETE /resources/:key
      // Delete a resource
      if (path.startsWith(`${basePath}/resources/`) && method === 'DELETE') {
        const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));
        const recursive = query['recursive'] === 'true';

        // Try to determine if it's an asset or folder
        let resourceType: 'asset' | 'folder' | undefined;
        for await (const resourceResult of repository.getResource(key)) {
          if (Result.isFailure(resourceResult)) {
            return respondError(resourceResult.failure, errorStatus.NOT_FOUND);
          }
          const firstResource = resourceResult.success[0];
          if (firstResource) {
            resourceType = firstResource.type;
          }
        }

        if (!resourceType) {
          return respondError(new BadRequestError('Resource not found'), errorStatus.NOT_FOUND);
        }

        if (resourceType === 'folder') {
          for await (const result of repository.deleteFolder(key, recursive)) {
            if (Result.isFailure(result)) {
              return respondError(result.failure, errorStatus.BAD_REQUEST);
            }
          }
        } else {
          for await (const result of repository.deleteAsset(key)) {
            if (Result.isFailure(result)) {
              return respondError(result.failure, errorStatus.BAD_REQUEST);
            }
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
