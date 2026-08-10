import * as Result from 'effect/Result';
import { Hono } from 'hono';
import type { Context } from 'hono';
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
   * Mount prefix advertised in the served OpenAPI document's `servers` URL.
   * The Hono app itself is prefix-agnostic — mount it at this same path.
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

function makeResponders(onError?: ((error: unknown) => void) | undefined, logger?: JsonApiLogger) {
  function respondError(c: Context, result: LaikaResult<unknown>) {
    if (Result.isFailure(result)) {
      onError?.(result.failure);
      const mapped = errorToJsonApiMapper(result.failure, logger);
      return c.json({ errors: mapped.errors }, mapped.status);
    }
    return c.json(
      {
        errors: [{ status: '500', code: 'unknown_error', title: 'Unknown Error', detail: 'An unknown error occurred' }],
      },
      500,
    );
  }

  function respondResource<T extends CollectionSettings>(
    c: Context,
    result: LaikaResult<T>,
    transformer: (item: T) => CollectionJsonApi,
  ) {
    if (Result.isFailure(result)) {
      return respondError(c, result);
    }
    return c.json({ data: transformer(result.success) });
  }

  function respondCollection<T extends CollectionSettings>(
    c: Context,
    result: LaikaResult<readonly T[]>,
    transformer: (item: T) => CollectionJsonApi,
  ) {
    if (Result.isFailure(result)) {
      return respondError(c, result);
    }
    return c.json({ data: result.success.map(item => transformer(item)) });
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
 * Built on Hono rather than `@effect/platform` HttpApi: this API is meant to be
 * dropped into a consumer's *existing* router/framework, and Hono composes far
 * more cleanly there — its `Request`→`Response` `fetch` handler, `.route()`
 * mounting, and middleware model plug into arbitrary hosts without dragging the
 * Effect runtime into the caller's routing layer.
 */
export function buildJsonApi(options: CatalogApiOptions) {
  const { repo, onError, logger, basePath = '', authorize } = options;
  const { respondError, respondResource, respondCollection } = makeResponders(onError, logger);
  // Register every route under `basePath` so the API works when mounted at a
  // non-root path — requests arrive at `${basePath}/openapi.json`, not `/openapi.json`.
  const app = new Hono().basePath(basePath);

  // Run the per-action authorization hook. Returns a ready error Response when
  // the action is denied, or `null` when it's allowed.
  const authorizeAction = async (
    c: Context,
    action: CatalogAuthorizeAction,
  ): Promise<Response | null> => {
    const denial = resolveAuthorization(await authorize({ ...action, request: c.req.raw }));
    if (!denial) return null;
    return respondError(c, Result.fail(denial));
  };

  // Ensure all responses carry Cache-Control: no-store
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
  });

  // Global error handler
  app.onError((err, c) => {
    logger?.error('catalog-api unhandled error:', err.constructor.name, err.message, err.stack);

    onError?.(err);

    // Handle AWS SDK errors
    if (err.name === 'NetworkingError' || err.name === 'TimeoutError') {
      return c.json(
        {
          errors: [
            {
              status: '503',
              code: 'service_unavailable',
              title: 'Service Unavailable',
              detail: `Cannot connect to DynamoDB: ${err.message}. Check if DynamoDB Local is running and accessible.`,
            },
          ],
        },
        503,
      );
    }

    throw err;
  });

  // OpenAPI document
  app.get('/openapi.json', async c => {
    const denied = await authorizeAction(c, { action: 'readOpenApi', format: 'json' });
    if (denied) return denied;
    const url = new URL(c.req.url);
    const doc = (await loadOpenApiBuilder())({ basePath });
    return c.json({
      ...doc,
      servers: [{ url: `${url.origin}${basePath}` }],
    });
  });

  app.get('/openapi.yaml', async c => {
    const denied = await authorizeAction(c, { action: 'readOpenApi', format: 'yaml' });
    if (denied) return denied;
    const url = new URL(c.req.url);
    const doc = (await loadOpenApiBuilder())({ basePath });
    const yaml = openApiDocumentToYaml({
      ...doc,
      servers: [{ url: `${url.origin}${basePath}` }],
    });
    return c.body(yaml, 200, { 'Content-Type': 'application/yaml' });
  });

  // Collections
  app.get('/collections', async c => {
    const denied = await authorizeAction(c, { action: 'listCollections' });
    if (denied) return denied;
    const settings = await LaikaTask.runPromiseResult(repo.getCatalog());
    if (Result.isFailure(settings)) {
      return respondError(c, settings);
    }
    const collections = settings.success.collections ?? {};
    const settingsList = Object.values(collections);
    return respondCollection(c, Result.succeed(settingsList), collectionToJsonApi);
  });

  app.get('/collections/:key', async c => {
    const key = c.req.param('key');
    const denied = await authorizeAction(c, { action: 'getCollection', key });
    if (denied) return denied;
    const allSettings = await LaikaTask.runPromiseResult(repo.getCatalog());
    if (Result.isFailure(allSettings)) {
      return respondError(c, allSettings);
    }
    const collections = allSettings.success.collections ?? {};
    const collectionSettings = collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
      );
    }
    if (collectionSettings.type === 'document') {
      const docSettingsResult = await LaikaTask.runPromiseResult(repo.getDocumentCollectionSettings(key));
      if (Result.isFailure(docSettingsResult)) {
        return respondError(c, docSettingsResult);
      }
      return respondResource(c, docSettingsResult, collectionToJsonApi);
    } else if (collectionSettings.type === 'media') {
      const mediaSettingsResult = await LaikaTask.runPromiseResult(repo.getMediaCollectionSettings(key));
      if (Result.isFailure(mediaSettingsResult)) {
        return respondError(c, mediaSettingsResult);
      }
      return respondResource(c, mediaSettingsResult, collectionToJsonApi);
    }
    return respondError(c, Result.fail(new BadRequestError(`Unknown collection type`)));
  });

  app.post('/collections', async c => {
    try {
      const jsonData = await c.req.json();
      const validatedData = decodeCollectionJsonApi(jsonData.data);
      const body = collectionFromJsonApi(validatedData as CollectionJsonApi);

      const denied = await authorizeAction(c, { action: 'createCollection', collection: body });
      if (denied) return denied;

      if (body.type === 'document') {
        const result = await LaikaTask.runPromiseResult(repo.putDocumentCollectionSettings(body.key, body));
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(body) }, 201);
      } else if (body.type === 'media') {
        const result = await LaikaTask.runPromiseResult(repo.putMediaCollectionSettings(body.key, body));
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(body) }, 201);
      }
      return respondError(c, Result.fail(new BadRequestError(`Unknown collection type`)));
    } catch (error) {
      onError?.(error);
      const mapped = errorToJsonApiMapper(new BadRequestError((error as Error).message), logger);
      return c.json({ errors: mapped.errors }, 400);
    }
  });

  app.patch('/collections/:key', async c => {
    try {
      const key = c.req.param('key');

      const allSettings = await LaikaTask.runPromiseResult(repo.getCatalog());
      if (Result.isFailure(allSettings)) {
        return respondError(c, allSettings);
      }
      const collections = allSettings.success.collections ?? {};
      if (!collections[key]) {
        return respondError(
          c,
          Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
        );
      }

      const jsonData = await c.req.json();
      const validatedData = decodeCollectionJsonApi(jsonData.data);
      const body = collectionFromJsonApi(validatedData as CollectionJsonApi);

      if (body.key !== key) {
        return respondError(
          c,
          Result.fail(
            new ConflictError(
              `Body data.id ('${body.key}') does not match URL key ('${key}'). Use the URL key as the resource identifier.`,
            ),
          ),
        );
      }

      const bodyWithKey = { ...body, key };

      const denied = await authorizeAction(c, { action: 'updateCollection', key, collection: bodyWithKey });
      if (denied) return denied;

      if (bodyWithKey.type === 'document') {
        const result = await LaikaTask.runPromiseResult(repo.putDocumentCollectionSettings(key, bodyWithKey));
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(bodyWithKey) });
      } else if (bodyWithKey.type === 'media') {
        const result = await LaikaTask.runPromiseResult(repo.putMediaCollectionSettings(key, bodyWithKey));
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(bodyWithKey) });
      }
      return respondError(c, Result.fail(new BadRequestError(`Unknown collection type`)));
    } catch (error) {
      onError?.(error);
      const mapped = errorToJsonApiMapper(new BadRequestError((error as Error).message), logger);
      return c.json({ errors: mapped.errors }, 400);
    }
  });

  app.delete('/collections/:key', async c => {
    const key = c.req.param('key');
    const denied = await authorizeAction(c, { action: 'deleteCollection', key });
    if (denied) return denied;
    const allSettings = await LaikaTask.runPromiseResult(repo.getCatalog());
    if (Result.isFailure(allSettings)) {
      return respondError(c, allSettings);
    }
    const collections = allSettings.success.collections ?? {};
    const collectionSettings = collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
      );
    }
    // Remove collection settings - create a new object without the key
    const { [key]: _, ...remainingCollections } = collections;
    const updatedSettings = {
      ...allSettings.success,
      collections: remainingCollections,
    };
    const result = await LaikaTask.runPromiseResult(repo.putCatalog(updatedSettings));
    if (Result.isFailure(result)) {
      return respondError(c, result);
    }
    return c.body(null, 204);
  });

  return app;
}
