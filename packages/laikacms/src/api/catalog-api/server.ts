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
  | { action: 'updateCollection', key: string, collection: CollectionSettings }
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
   * Mount prefix advertised in the served OpenAPI document's `servers` URL,
   * and stripped from the incoming pathname before routing. Mount the handler
   * at this same path.
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

/**
 * Every response this handler produces is uncacheable: the catalog is mutable
 * settings, and a stale collection list is worse than a slow one. Setting the
 * header at the single construction point is why there is no response-mutating
 * middleware to replace.
 */
const json = (body: unknown, status: number = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

// decodeURIComponent throws on malformed sequences; degrade to the raw segment
// rather than 500ing on bad input, and let the catalog layer reject it.
const safeDecode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

function makeResponders(onError?: ((error: unknown) => void) | undefined, logger?: JsonApiLogger) {
  function respondError(result: LaikaResult<unknown>): Response {
    if (Result.isFailure(result)) {
      onError?.(result.failure);
      const mapped = errorToJsonApiMapper(result.failure, logger);
      return json({ errors: mapped.errors }, mapped.status);
    }
    return json(
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
    if (Result.isFailure(result)) {
      return respondError(result);
    }
    return json({ data: transformer(result.success) });
  }

  function respondCollection<T extends CollectionSettings>(
    result: LaikaResult<readonly T[]>,
    transformer: (item: T) => CollectionJsonApi,
  ): Response {
    if (Result.isFailure(result)) {
      return respondError(result);
    }
    return json({ data: result.success.map(item => transformer(item)) });
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
 *
 * The returned handler is a bare `{ fetch(Request): Promise<Response> }`, with
 * no web framework behind it (LCMS-645). This API is meant to be dropped into a
 * consumer's *existing* router, so the only thing it can safely assume is the
 * platform `Request`/`Response` pair: mount it under Hono, Express, a Worker's
 * `export default`, or call `fetch` directly in a test. It also keeps the
 * Effect runtime out of the caller's routing layer, and matches the shape the
 * documents, assets and storage handlers already return.
 */
export function buildJsonApi(options: CatalogApiOptions) {
  const { repo, onError, logger, basePath = '', authorize } = options;
  const { respondError, respondResource, respondCollection } = makeResponders(onError, logger);

  return {
    async fetch(request: Request): Promise<Response> {
      try {
        return await fetchInner(request);
      } catch (err) {
        return handleUnexpected(err);
      }
    },
  };

  /**
   * The one non-JSON:API failure mode carried over from the previous global
   * error handler: an AWS SDK transport failure against DynamoDB is reported
   * as 503 with a hint, because the usual cause is a local DynamoDB that is
   * not running. Anything else is rethrown, unchanged, exactly as before.
   */
  function handleUnexpected(err: unknown): Response {
    const error = err as { name?: string, message?: string, stack?: string, constructor?: { name?: string } };
    logger?.error('catalog-api unhandled error:', error?.constructor?.name, error?.message, error?.stack);

    onError?.(err);

    if (error?.name === 'NetworkingError' || error?.name === 'TimeoutError') {
      return json(
        {
          errors: [
            {
              status: '503',
              code: 'service_unavailable',
              title: 'Service Unavailable',
              detail:
                `Cannot connect to DynamoDB: ${error.message}. Check if DynamoDB Local is running and accessible.`,
            },
          ],
        },
        503,
      );
    }

    throw err;
  }

  async function fetchInner(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // Run the per-action authorization hook. Returns a ready error Response
    // when the action is denied, or `null` when it's allowed.
    const authorizeAction = async (action: CatalogAuthorizeAction): Promise<Response | null> => {
      const denial = resolveAuthorization(await authorize({ ...action, request }));
      if (!denial) return null;
      return respondError(Result.fail(denial));
    };

    let path = url.pathname.substring(basePath.length);
    if (path.startsWith('/')) path = path.substring(1);
    if (path.endsWith('/')) path = path.slice(0, -1);

    if (path === 'openapi.json' && method === 'GET') {
      const denied = await authorizeAction({ action: 'readOpenApi', format: 'json' });
      if (denied) return denied;
      const doc = (await loadOpenApiBuilder())({ basePath });
      return json({ ...doc, servers: [{ url: `${url.origin}${basePath}` }] });
    }

    if (path === 'openapi.yaml' && method === 'GET') {
      const denied = await authorizeAction({ action: 'readOpenApi', format: 'yaml' });
      if (denied) return denied;
      const doc = (await loadOpenApiBuilder())({ basePath });
      const yaml = openApiDocumentToYaml({ ...doc, servers: [{ url: `${url.origin}${basePath}` }] });
      return new Response(yaml, {
        status: 200,
        headers: { 'Content-Type': 'application/yaml', 'Cache-Control': 'no-store' },
      });
    }

    // `collections` and `collections/{key}`. A key never spans a slash, which
    // is the same shape the `:key` route matched before.
    const segments = path === '' ? [] : path.split('/');

    if (segments[0] === 'collections' && segments.length === 1) {
      if (method === 'GET') return await listCollections(authorizeAction);
      if (method === 'POST') return await createCollection(request, authorizeAction);
    }

    if (segments[0] === 'collections' && segments.length === 2) {
      const key = safeDecode(segments[1]!);
      if (method === 'GET') return await getCollection(key, authorizeAction);
      if (method === 'PATCH') return await updateCollection(request, key, authorizeAction);
      if (method === 'DELETE') return await deleteCollection(key, authorizeAction);
    }

    return respondError(Result.fail(new NotFoundError(`No route for ${method} ${url.pathname}.`)));
  }

  type AuthorizeAction = (action: CatalogAuthorizeAction) => Promise<Response | null>;

  async function listCollections(authorizeAction: AuthorizeAction): Promise<Response> {
    const denied = await authorizeAction({ action: 'listCollections' });
    if (denied) return denied;
    const settings = await LaikaTask.runPromiseResult(repo.getCatalog());
    if (Result.isFailure(settings)) {
      return respondError(settings);
    }
    const collections = settings.success.collections ?? {};
    return respondCollection(Result.succeed(Object.values(collections)), collectionToJsonApi);
  }

  async function getCollection(key: string, authorizeAction: AuthorizeAction): Promise<Response> {
    const denied = await authorizeAction({ action: 'getCollection', key });
    if (denied) return denied;
    const allSettings = await LaikaTask.runPromiseResult(repo.getCatalog());
    if (Result.isFailure(allSettings)) {
      return respondError(allSettings);
    }
    const collections = allSettings.success.collections ?? {};
    const collectionSettings = collections[key];
    if (!collectionSettings) {
      return respondError(Result.fail(new NotFoundError(`Collection '${key}' not found.`)));
    }
    if (collectionSettings.type === 'document') {
      const docSettingsResult = await LaikaTask.runPromiseResult(repo.getDocumentCollectionSettings(key));
      if (Result.isFailure(docSettingsResult)) {
        return respondError(docSettingsResult);
      }
      return respondResource(docSettingsResult, collectionToJsonApi);
    } else if (collectionSettings.type === 'media') {
      const mediaSettingsResult = await LaikaTask.runPromiseResult(repo.getMediaCollectionSettings(key));
      if (Result.isFailure(mediaSettingsResult)) {
        return respondError(mediaSettingsResult);
      }
      return respondResource(mediaSettingsResult, collectionToJsonApi);
    }
    return respondError(Result.fail(new BadRequestError(`Unknown collection type`)));
  }

  async function createCollection(request: Request, authorizeAction: AuthorizeAction): Promise<Response> {
    try {
      const jsonData = await request.json() as { data: unknown };
      const validatedData = decodeCollectionJsonApi(jsonData.data);
      const body = collectionFromJsonApi(validatedData as CollectionJsonApi);

      const denied = await authorizeAction({ action: 'createCollection', collection: body });
      if (denied) return denied;

      if (body.type === 'document') {
        const result = await LaikaTask.runPromiseResult(repo.putDocumentCollectionSettings(body.key, body));
        if (Result.isFailure(result)) {
          return respondError(result);
        }
        return json({ data: collectionToJsonApi(body) }, 201);
      } else if (body.type === 'media') {
        const result = await LaikaTask.runPromiseResult(repo.putMediaCollectionSettings(body.key, body));
        if (Result.isFailure(result)) {
          return respondError(result);
        }
        return json({ data: collectionToJsonApi(body) }, 201);
      }
      return respondError(Result.fail(new BadRequestError(`Unknown collection type`)));
    } catch (error) {
      onError?.(error);
      const mapped = errorToJsonApiMapper(new BadRequestError((error as Error).message), logger);
      return json({ errors: mapped.errors }, 400);
    }
  }

  async function updateCollection(
    request: Request,
    key: string,
    authorizeAction: AuthorizeAction,
  ): Promise<Response> {
    try {
      const allSettings = await LaikaTask.runPromiseResult(repo.getCatalog());
      if (Result.isFailure(allSettings)) {
        return respondError(allSettings);
      }
      const collections = allSettings.success.collections ?? {};
      if (!collections[key]) {
        return respondError(Result.fail(new NotFoundError(`Collection '${key}' not found.`)));
      }

      const jsonData = await request.json() as { data: unknown };
      const validatedData = decodeCollectionJsonApi(jsonData.data);
      const body = collectionFromJsonApi(validatedData as CollectionJsonApi);

      if (body.key !== key) {
        return respondError(
          Result.fail(
            new ConflictError(
              `Body data.id ('${body.key}') does not match URL key ('${key}'). Use the URL key as the resource identifier.`,
            ),
          ),
        );
      }

      const bodyWithKey = { ...body, key };

      const denied = await authorizeAction({ action: 'updateCollection', key, collection: bodyWithKey });
      if (denied) return denied;

      if (bodyWithKey.type === 'document') {
        const result = await LaikaTask.runPromiseResult(repo.putDocumentCollectionSettings(key, bodyWithKey));
        if (Result.isFailure(result)) {
          return respondError(result);
        }
        return json({ data: collectionToJsonApi(bodyWithKey) });
      } else if (bodyWithKey.type === 'media') {
        const result = await LaikaTask.runPromiseResult(repo.putMediaCollectionSettings(key, bodyWithKey));
        if (Result.isFailure(result)) {
          return respondError(result);
        }
        return json({ data: collectionToJsonApi(bodyWithKey) });
      }
      return respondError(Result.fail(new BadRequestError(`Unknown collection type`)));
    } catch (error) {
      onError?.(error);
      const mapped = errorToJsonApiMapper(new BadRequestError((error as Error).message), logger);
      return json({ errors: mapped.errors }, 400);
    }
  }

  async function deleteCollection(key: string, authorizeAction: AuthorizeAction): Promise<Response> {
    const denied = await authorizeAction({ action: 'deleteCollection', key });
    if (denied) return denied;
    const allSettings = await LaikaTask.runPromiseResult(repo.getCatalog());
    if (Result.isFailure(allSettings)) {
      return respondError(allSettings);
    }
    const collections = allSettings.success.collections ?? {};
    const collectionSettings = collections[key];
    if (!collectionSettings) {
      return respondError(Result.fail(new NotFoundError(`Collection '${key}' not found.`)));
    }
    // Remove collection settings - create a new object without the key
    const { [key]: _, ...remainingCollections } = collections;
    const updatedSettings = { ...allSettings.success, collections: remainingCollections };
    const result = await LaikaTask.runPromiseResult(repo.putCatalog(updatedSettings));
    if (Result.isFailure(result)) {
      return respondError(result);
    }
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }
}
