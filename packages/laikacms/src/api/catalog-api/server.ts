import * as Result from 'effect/Result';
import type { CatalogProvider } from 'laikacms/catalog';
import { type CollectionSettings } from 'laikacms/catalog';
import type { LaikaResult } from 'laikacms/core';
import { BadRequestError, ConflictError, LaikaTask, NotFoundError } from 'laikacms/core';
import type { AuthorizeDecision, JsonApiLogger } from 'laikacms/json-api';
import { errorToJsonApiMapper, openApiDocumentToYaml, resolveAuthorization } from 'laikacms/json-api';
import {
  collectionFromJsonApi,
  type CollectionJsonApi,
  collectionToJsonApi,
  decodeCollectionJsonApi,
} from './jsonapi.js';

// The spec is a large static object literal that only the two openapi routes
// ever read, so it is loaded on demand rather than statically imported: a
// deployment that never serves it keeps it out of the startup path, and
// bundlers can split it into a chunk of its own instead of inlining it into
// every worker that mounts this handler.
const loadOpenApiBuilder = async () => (await import('./openapi.js')).buildCatalogOpenApi;

/**
 * A single catalog action the API is about to perform, discriminated on
 * `action` and carrying that action's direct arguments (the collection key
 * and/or the parsed {@link CollectionSettings} body).
 */
export type CatalogAuthorizeAction =
  | { action: 'readOpenApi', format: 'json' | 'yaml' }
  | { action: 'listCollections' }
  | { action: 'getCollection', key: string }
  | { action: 'createCollection', collection: CollectionSettings }
  | { action: 'updateCollection', key: string, collection?: CollectionSettings }
  | { action: 'deleteCollection', key: string };

/**
 * The argument passed to a catalog {@link CatalogAuthorize} callback:
 * the action descriptor plus the entire originating {@link Request}.
 */
export type CatalogAuthorizeInput = CatalogAuthorizeAction & { request: Request };

/**
 * Per-action authorization callback. Invoked once for every catalog action
 * before the underlying settings provider is touched. Return `true` to allow,
 * `false` to deny with a 403, or a `LaikaError` to deny with a custom
 * status/message.
 */
export type CatalogAuthorize = (
  input: CatalogAuthorizeInput,
) => AuthorizeDecision | Promise<AuthorizeDecision>;

export interface CatalogApiOptions {
  repo: CatalogProvider;
  onError?(error: unknown): void;
  logger?: JsonApiLogger;
  /**
   * Mount prefix advertised in the served OpenAPI document's `servers` URL.
   * Strip this same prefix from incoming request paths before routing.
   */
  basePath?: string;
  /**
   * Per-action authorization hook. Required: there is no implicit default,
   * because an API that silently defaults to open is the failure mode this
   * option exists to prevent. Pass `allowAll` to state that a surface is
   * intentionally unauthenticated. See {@link CatalogAuthorize}.
   */
  authorize: CatalogAuthorize;
}

export interface CatalogApi {
  fetch(request: Request): Promise<Response>;
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function makeResponders(onError?: ((error: unknown) => void) | undefined, logger?: JsonApiLogger) {
  function respondError(result: LaikaResult<unknown>): Response {
    if (Result.isFailure(result)) {
      onError?.(result.failure);
      const mapped = errorToJsonApiMapper(result.failure, logger);
      return jsonResponse({ errors: mapped.errors }, mapped.status);
    }
    return jsonResponse(
      {
        errors: [{ status: '500', code: 'unknown_error', title: 'Unknown Error', detail: 'An unknown error occurred' }],
      },
      500,
    );
  }

  function respondResource<T extends CollectionSettings>(
    result: LaikaResult<T>,
    transformer: (item: T) => CollectionJsonApi,
  ): Response {
    if (Result.isFailure(result)) return respondError(result);
    return jsonResponse({ data: transformer(result.success) });
  }

  function respondCollection<T extends CollectionSettings>(
    result: LaikaResult<readonly T[]>,
    transformer: (item: T) => CollectionJsonApi,
  ): Response {
    if (Result.isFailure(result)) return respondError(result);
    return jsonResponse({ data: result.success.map(item => transformer(item)) });
  }

  return { respondError, respondResource, respondCollection };
}

/**
 * Build a JSON:API handler for the catalog settings provider.
 *
 * Access control is decided entirely by the required
 * {@link CatalogApiOptions.authorize} callback, which runs before every action
 * — including the two OpenAPI routes. This handler performs no *authentication*
 * of its own: `authorize` receives the originating `Request`, so validating a
 * Bearer token (or delegating to `@laikacms/server/api`, which does it for you)
 * is the caller's job.
 */
export function buildJsonApi(options: CatalogApiOptions): CatalogApi {
  const { repo, onError, logger, basePath = '', authorize } = options;
  const { respondError, respondResource, respondCollection } = makeResponders(onError, logger);

  const authorizeAction = async (
    request: Request,
    action: CatalogAuthorizeAction,
  ): Promise<Response | null> => {
    const denial = resolveAuthorization(await authorize({ ...action, request }));
    if (!denial) return null;
    return respondError(Result.fail(denial));
  };

  return {
    async fetch(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        const method = request.method.toUpperCase();

        // Strip basePath prefix so route matching is always against the relative path.
        let routePath = url.pathname;
        if (basePath) {
          if (!url.pathname.startsWith(basePath)) {
            return respondError(Result.fail(new NotFoundError('Endpoint not found')));
          }
          routePath = url.pathname.slice(basePath.length) || '/';
        }

        // GET /openapi.json
        if (routePath === '/openapi.json' && method === 'GET') {
          const denied = await authorizeAction(request, { action: 'readOpenApi', format: 'json' });
          if (denied) return denied;
          const doc = (await loadOpenApiBuilder())({ basePath });
          return jsonResponse({ ...doc, servers: [{ url: `${url.origin}${basePath}` }] });
        }

        // GET /openapi.yaml
        if (routePath === '/openapi.yaml' && method === 'GET') {
          const denied = await authorizeAction(request, { action: 'readOpenApi', format: 'yaml' });
          if (denied) return denied;
          const doc = (await loadOpenApiBuilder())({ basePath });
          const yaml = openApiDocumentToYaml({ ...doc, servers: [{ url: `${url.origin}${basePath}` }] });
          return new Response(yaml, {
            status: 200,
            headers: { 'Content-Type': 'application/yaml', 'Cache-Control': 'no-store' },
          });
        }

        // GET /collections — list
        if (routePath === '/collections' && method === 'GET') {
          const denied = await authorizeAction(request, { action: 'listCollections' });
          if (denied) return denied;
          const settings = await LaikaTask.runPromiseResult(repo.getCatalog());
          if (Result.isFailure(settings)) return respondError(settings);
          const collections = settings.success.collections ?? {};
          return respondCollection(Result.succeed(Object.values(collections)), collectionToJsonApi);
        }

        // POST /collections — create
        if (routePath === '/collections' && method === 'POST') {
          try {
            const jsonData = await request.json() as { data: unknown };
            const validatedData = decodeCollectionJsonApi(jsonData.data);
            const body = collectionFromJsonApi(validatedData as CollectionJsonApi);

            const denied = await authorizeAction(request, { action: 'createCollection', collection: body });
            if (denied) return denied;

            if (body.type === 'document') {
              const result = await LaikaTask.runPromiseResult(repo.putDocumentCollectionSettings(body.key, body));
              if (Result.isFailure(result)) return respondError(result);
              return jsonResponse({ data: collectionToJsonApi(body) }, 201);
            } else if (body.type === 'media') {
              const result = await LaikaTask.runPromiseResult(repo.putMediaCollectionSettings(body.key, body));
              if (Result.isFailure(result)) return respondError(result);
              return jsonResponse({ data: collectionToJsonApi(body) }, 201);
            }
            return respondError(Result.fail(new BadRequestError('Unknown collection type')));
          } catch (error) {
            onError?.(error);
            const mapped = errorToJsonApiMapper(new BadRequestError((error as Error).message), logger);
            return jsonResponse({ errors: mapped.errors }, 400);
          }
        }

        // /collections/:key routes
        const keyMatch = /^\/collections\/([^/]+)$/.exec(routePath);
        if (keyMatch) {
          const key = decodeURIComponent(keyMatch[1]!);

          // GET /collections/:key
          if (method === 'GET') {
            const denied = await authorizeAction(request, { action: 'getCollection', key });
            if (denied) return denied;
            const allSettings = await LaikaTask.runPromiseResult(repo.getCatalog());
            if (Result.isFailure(allSettings)) return respondError(allSettings);
            const collections = allSettings.success.collections ?? {};
            const collectionSettings = collections[key];
            if (!collectionSettings) {
              return respondError(Result.fail(new NotFoundError(`Collection '${key}' not found.`)));
            }
            if (collectionSettings.type === 'document') {
              const result = await LaikaTask.runPromiseResult(repo.getDocumentCollectionSettings(key));
              if (Result.isFailure(result)) return respondError(result);
              return respondResource(result, collectionToJsonApi);
            } else if (collectionSettings.type === 'media') {
              const result = await LaikaTask.runPromiseResult(repo.getMediaCollectionSettings(key));
              if (Result.isFailure(result)) return respondError(result);
              return respondResource(result, collectionToJsonApi);
            }
            return respondError(Result.fail(new BadRequestError('Unknown collection type')));
          }

          // PATCH /collections/:key — update
          if (method === 'PATCH') {
            try {
              // Authorize before any repo read so callers cannot probe collection
              // existence via 404/409 differentials without valid credentials.
              const denied = await authorizeAction(request, { action: 'updateCollection', key });
              if (denied) return denied;

              const allSettings = await LaikaTask.runPromiseResult(repo.getCatalog());
              if (Result.isFailure(allSettings)) return respondError(allSettings);
              const collections = allSettings.success.collections ?? {};
              if (!collections[key]) {
                return respondError(Result.fail(new NotFoundError(`Collection '${key}' not found.`)));
              }

              const jsonData = await request.json() as { data: unknown };
              const validatedData = decodeCollectionJsonApi(jsonData.data);
              const body = collectionFromJsonApi(validatedData as CollectionJsonApi);

              if (body.key !== key) {
                return respondError(Result.fail(
                  new ConflictError(
                    `Body data.id ('${body.key}') does not match URL key ('${key}'). Use the URL key as the resource identifier.`,
                  ),
                ));
              }

              const bodyWithKey = { ...body, key };

              if (bodyWithKey.type === 'document') {
                const result = await LaikaTask.runPromiseResult(repo.putDocumentCollectionSettings(key, bodyWithKey));
                if (Result.isFailure(result)) return respondError(result);
                return jsonResponse({ data: collectionToJsonApi(bodyWithKey) });
              } else if (bodyWithKey.type === 'media') {
                const result = await LaikaTask.runPromiseResult(repo.putMediaCollectionSettings(key, bodyWithKey));
                if (Result.isFailure(result)) return respondError(result);
                return jsonResponse({ data: collectionToJsonApi(bodyWithKey) });
              }
              return respondError(Result.fail(new BadRequestError('Unknown collection type')));
            } catch (error) {
              onError?.(error);
              const mapped = errorToJsonApiMapper(new BadRequestError((error as Error).message), logger);
              return jsonResponse({ errors: mapped.errors }, 400);
            }
          }

          // DELETE /collections/:key
          if (method === 'DELETE') {
            const denied = await authorizeAction(request, { action: 'deleteCollection', key });
            if (denied) return denied;
            const allSettings = await LaikaTask.runPromiseResult(repo.getCatalog());
            if (Result.isFailure(allSettings)) return respondError(allSettings);
            const collections = allSettings.success.collections ?? {};
            if (!collections[key]) {
              return respondError(Result.fail(new NotFoundError(`Collection '${key}' not found.`)));
            }
            const { [key]: _, ...remainingCollections } = collections;
            const updatedSettings = { ...allSettings.success, collections: remainingCollections };
            const result = await LaikaTask.runPromiseResult(repo.putCatalog(updatedSettings));
            if (Result.isFailure(result)) return respondError(result);
            return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
          }
        }

        return respondError(Result.fail(new NotFoundError('Endpoint not found')));
      } catch (err) {
        const error = err as Error;
        logger?.error('catalog-api unhandled error:', error.constructor.name, error.message, error.stack);
        onError?.(err);

        if (error.name === 'NetworkingError' || error.name === 'TimeoutError') {
          return jsonResponse(
            {
              errors: [{
                status: '503',
                code: 'service_unavailable',
                title: 'Service Unavailable',
                detail:
                  `Cannot connect to DynamoDB: ${error.message}. Check if DynamoDB Local is running and accessible.`,
              }],
            },
            503,
          );
        }

        throw err;
      }
    },
  };
}
