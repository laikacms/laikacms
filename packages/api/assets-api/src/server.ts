import { Result, failure, ErrorStatus, errorStatus } from '@laikacms/core';
import { AssetsRepository, FetchHints } from '@laikacms/assets';
import {
  JsonApiResource,
  JsonApiResponse,
  JsonApiCollectionResponse,
  resourceToJsonApi,
  assetToJsonApi,
  folderToJsonApi,
  assetVariationsToJsonApi,
  assetMetadataToJsonApi,
  assetCreateFromJsonApiZ,
  assetUpdateFromJsonApiZ,
  folderCreateFromJsonApiZ,
  parseIncludeQuery,
  parsePaginationQuery,
  buildPaginationLinks,
  assetUrlToJsonApi,
  assetCreateWithContentZ,
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
  headers: Record<string, string> = {}
): Response => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/vnd.api+json',
      ...headers,
    },
  });
};

function respondError(result: Result<unknown>, status: ErrorStatus = 400): Response {
  // Result has code and messages directly, not an errors array
  const errorResult = result as { code: string; messages: string[] };
  return json(
    {
      errors: [{
        status: String(status),
        code: errorResult.code,
        detail: errorResult.messages.join(', '),
      }],
    },
    status
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
    status
  );
}

function respondResource(
  resource: JsonApiResource,
  included?: JsonApiResource[]
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
  meta?: Record<string, unknown>
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
// Server Builder
// ============================================

export function buildAssetsApi(options: AssetsApiOptions): AssetsApi {
  const { repository, basePath = '/api/assets' } = options;

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

        for await (const batch of repository.listResources(folderKey, {
          pagination: paginationOptions,
          depth,
          hints,
        })) {
          if (!batch.success) {
            return respondError(batch, errorStatus.BAD_REQUEST);
          }

          resources.push(...batch.data.map(resource => resourceToJsonApi.parse(resource)));

          const assets = batch.data.filter(r => r.type === 'asset');

          for await (const metadataResult of repository.getMetadata(assets)) {
            if (metadataResult.success) {
              for (const metadata of metadataResult.data) {
                included.push(assetMetadataToJsonApi.parse(metadata));
              }
            }
          }

          for await (const urlsResult of repository.getUrls(assets)) {
            if (urlsResult.success) {
              for (const urls of urlsResult.data) {
                included.push(assetUrlToJsonApi.parse(urls));
              }
            }
          }

          for await (const variationsResult of repository.getVariations(assets)) {
            if (variationsResult.success) {
              for (const variations of variationsResult.data) {
                included.push(assetVariationsToJsonApi.parse(variations));
              }
            }
          }

          // Check if there are more results
          if (batch.data.length >= paginationOptions.limit) {
            hasMore = true;
            nextCursor = batch.data[batch.data.length - 1]?.key;
          }
        }

        const links = buildPaginationLinks(
          url.toString(),
          pagination,
          hasMore,
          nextCursor,
          pagination.cursor
        );

        return respondCollection(resources, included, links);
      }

      // Route: GET /resources/:key
      // Get a single resource by key
      if (path.startsWith(`${basePath}/resources/`) && method === 'GET') {
        const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));
        
        const result = await repository.getResource(key, { hints });
        
        if (!result.success) {
          return respondError(result, errorStatus.NOT_FOUND);
        }

        const resource = resourceToJsonApi.parse(result.data);
        const included: JsonApiResource[] = [];

        // Fetch included data for assets
        if (result.data.type === 'asset') {
          if (hints.metadata) {
            for await (const metadataResult of repository.getMetadata([result.data])) {
              if (metadataResult.success) {
                included.push(assetMetadataToJsonApi.parse(metadataResult.data[0]));
              }
            }
          }
          if (hints.urls) {
            for await (const urlsResult of repository.getUrls([result.data])) {
              if (urlsResult.success) {
                included.push(assetUrlToJsonApi.parse(urlsResult.data[0]));
              }
            }
          }
          if (hints.variations) {
            for await (const variationsResult of repository.getVariations([result.data])) {
              if (variationsResult.success) {
                included.push(assetVariationsToJsonApi.parse(variationsResult.data[0]));
              }
            }
          }
        }

        return respondResource(resource, included);
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
              failure('bad_request', ['Missing file in multipart form data']),
              errorStatus.BAD_REQUEST
            );
          }

          let metadata: { key?: string; mimeType?: string; filename?: string; customMetadata?: Record<string, string>; cacheControl?: string } | undefined;
          if (metadataJson) {
            try {
              metadata = JSON.parse(metadataJson);
            } catch {
              return respondError(
                failure('bad_request', ['Invalid metadata JSON']),
                errorStatus.BAD_REQUEST
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
          const key = keyField || metadata?.key || file.name;
          const mimeType = mimeTypeField || metadata?.mimeType || file.type || 'application/octet-stream';
          const filename = filenameField || metadata?.filename || file.name;
          const cacheControl = cacheControlField || metadata?.cacheControl;
          const content = await file.arrayBuffer();

          const result = await repository.createAsset({
            key,
            mimeType,
            content,
            filename,
            customMetadata,
            cacheControl,
          });

          if (!result.success) {
            return respondError(result, errorStatus.BAD_REQUEST);
          }

          return respondResource(assetToJsonApi.parse(result.data));
        }

        // Handle JSON:API request for folder creation
        if (contentType.includes('application/vnd.api+json') || contentType.includes('application/json')) {
          const body = await request.json() as { data: unknown };
          const data = body.data as { type?: string };

          if (data.type === 'folder') {
            const parsed = folderCreateFromJsonApiZ.safeParse(data);
            if (!parsed.success) {
              return respondValidationError(
                parsed.error.issues.map(e => ({ message: e.message })),
                errorStatus.BAD_REQUEST
              );
            }

            const folderCreate = folderCreateFromJsonApiZ.parse(data);
            const result = await repository.createFolder(folderCreate);
            if (!result.success) {
              return respondError(result, errorStatus.BAD_REQUEST);
            }

            return respondResource(folderToJsonApi.parse(result.data));
          }

          // Asset creation via JSON (content must be base64 encoded)
          if (data.type === 'asset') {
            const parsed = assetCreateWithContentZ.safeParse(data);
            if (!parsed.success) {
              return respondValidationError(
                parsed.error.issues.map(e => ({ message: e.message })),
                errorStatus.BAD_REQUEST
              );
            }

            // Get base64 content from attributes
            const base64Content = parsed.data.content;
            if (!base64Content) {
              return respondError(
                failure('bad_request', ['Missing content in asset creation. Use multipart/form-data for binary uploads.']),
                errorStatus.BAD_REQUEST
              );
            }

            // Decode base64 to ArrayBuffer
            const binaryString = atob(base64Content);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            const result = await repository.createAsset({
              ...parsed.data,
              content: bytes.buffer,
            });

            if (!result.success) {
              return respondError(result, errorStatus.BAD_REQUEST);
            }

            return respondResource(assetToJsonApi.parse(result.data));
          }

          return respondError(
            failure('bad_request', ['Invalid resource type. Must be "asset" or "folder".']),
            errorStatus.BAD_REQUEST
          );
        }

        return respondError(
          failure('bad_request', ['Unsupported Content-Type. Use multipart/form-data or application/vnd.api+json.']),
          errorStatus.BAD_REQUEST
        );
      }

      // Route: PATCH /resources/:key
      // Update an asset
      if (path.startsWith(`${basePath}/resources/`) && method === 'PATCH') {
        const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));
        const body = await request.json() as { data: Record<string, unknown> };
        
        // Add the key as id for validation
        const dataWithId = { ...body.data, id: key };
        const parsed = assetUpdateFromJsonApiZ.safeParse(dataWithId);
        if (!parsed.success) {
          return respondValidationError(
            parsed.error.issues.map(e => ({ message: e.message })),
            errorStatus.BAD_REQUEST
          );
        }

        const result = await repository.updateAsset(parsed.data);
        if (!result.success) {
          return respondError(result, errorStatus.BAD_REQUEST);
        }

        return respondResource(assetToJsonApi.parse(result.data));
      }

      // Route: DELETE /resources/:key
      // Delete a resource
      if (path.startsWith(`${basePath}/resources/`) && method === 'DELETE') {
        const key = decodeURIComponent(path.slice(`${basePath}/resources/`.length));
        const recursive = query['recursive'] === 'true';

        // Try to determine if it's an asset or folder
        const resourceResult = await repository.getResource(key);
        
        if (!resourceResult.success) {
          return respondError(resourceResult, errorStatus.NOT_FOUND);
        }

        if (resourceResult.data.type === 'folder') {
          const result = await repository.deleteFolder(key, recursive);
          if (!result.success) {
            return respondError(result, errorStatus.BAD_REQUEST);
          }
        } else {
          const result = await repository.deleteAsset(key);
          if (!result.success) {
            return respondError(result, errorStatus.BAD_REQUEST);
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
        404
      );
    },
  };
}
