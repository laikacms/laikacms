import * as Result from 'effect/Result';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import { type CollectionSettings } from 'laikacms/contentbase-settings';
import type { LaikaResult } from 'laikacms/core';
import { BadRequestError, ConflictError, ErrorCodeToStatusMap, LaikaTask, NotFoundError } from 'laikacms/core';
import type { JsonApiLogger } from 'laikacms/json-api';
import {
  collectionFromJsonApi,
  type CollectionJsonApi,
  collectionToJsonApi,
  decodeCollectionJsonApi,
} from './jsonapi.js';
import { buildContentbaseOpenApi } from './openapi.js';

export interface ContentBaseApiOptions {
  repo: ContentBaseSettingsProvider;
  onError?(error: unknown): void;
  logger?: JsonApiLogger;
  /**
   * Mount prefix advertised in the served OpenAPI document's `servers` URL.
   * The Hono app itself is prefix-agnostic — mount it at this same path.
   */
  basePath?: string;
}

// JSON:API error response
function respondError(
  c: Context,
  result: LaikaResult<unknown>,
  onError?: ((error: unknown) => void) | undefined,
) {
  if (Result.isFailure(result)) {
    onError?.(result.failure);
    const status = (ErrorCodeToStatusMap[result.failure.code as keyof typeof ErrorCodeToStatusMap] ?? 500) as
      | 400
      | 401
      | 403
      | 404
      | 409
      | 413
      | 415
      | 422
      | 429
      | 500
      | 501
      | 503
      | 504;
    return c.json(
      {
        errors: [
          {
            status: String(status),
            title: result.failure.code || 'Error',
            detail: result.failure.message,
          },
        ],
      },
      status,
    );
  }
  return c.json(
    {
      errors: [
        {
          status: '500',
          title: 'Unknown Error',
          detail: 'An unknown error occurred',
        },
      ],
    },
    500,
  );
}

// JSON:API success response for single resource
function respondResource<T extends CollectionSettings>(
  c: Context,
  result: LaikaResult<T>,
  transformer: (item: T) => CollectionJsonApi,
  onError?: ((error: unknown) => void) | undefined,
) {
  if (Result.isFailure(result)) {
    return respondError(c, result, onError);
  }
  return c.json({ data: transformer(result.success) });
}

// JSON:API success response for resource collection
function respondCollection<T extends CollectionSettings>(
  c: Context,
  result: LaikaResult<readonly T[]>,
  transformer: (item: T) => CollectionJsonApi,
) {
  if (Result.isFailure(result)) {
    return respondError(c, result);
  }
  return c.json({
    data: result.success.map(item => transformer(item)),
  });
}

/**
 * Build a JSON:API handler for the contentbase settings provider.
 *
 * ⚠️ This handler ships **no authentication**. Wrap it (e.g. with
 * `laikacms/decap-api` or a custom middleware that validates a Bearer token)
 * before exposing it to an untrusted network — otherwise anyone who can reach
 * `fetch` can read, mutate, and delete collection settings.
 */
export function buildJsonApi(options: ContentBaseApiOptions) {
  const { repo, onError, logger, basePath = '' } = options;
  const app = new Hono();

  // Ensure all responses carry Cache-Control: no-store
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
  });

  // Global error handler
  app.onError((err, c) => {
    logger?.error('contentbase-api unhandled error:', err.constructor.name, err.message, err.stack);

    onError?.(err);

    // Handle AWS SDK errors
    if (err.name === 'NetworkingError' || err.name === 'TimeoutError') {
      return c.json(
        {
          errors: [
            {
              status: '503',
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
  app.get('/openapi.json', c => {
    const url = new URL(c.req.url);
    const doc = buildContentbaseOpenApi({ basePath });
    return c.json({
      ...doc,
      servers: [{ url: `${url.origin}${basePath}` }],
    });
  });

  // Collections
  app.get('/collections', async c => {
    const settings = await LaikaTask.runPromiseResult(repo.getSettings());
    if (Result.isFailure(settings)) {
      return respondError(c, settings, onError);
    }
    const collections = settings.success.collections ?? {};
    const settingsList = Object.values(collections);
    return respondCollection(c, Result.succeed(settingsList), collectionToJsonApi);
  });

  app.get('/collections/:key', async c => {
    const key = c.req.param('key');
    const allSettings = await LaikaTask.runPromiseResult(repo.getSettings());
    if (Result.isFailure(allSettings)) {
      return respondError(c, allSettings, onError);
    }
    const collections = allSettings.success.collections ?? {};
    const collectionSettings = collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
        onError,
      );
    }
    if (collectionSettings.type === 'document') {
      const docSettingsResult = await LaikaTask.runPromiseResult(repo.getDocumentCollectionSettings(key));
      if (Result.isFailure(docSettingsResult)) {
        return respondError(c, docSettingsResult, onError);
      }
      return respondResource(c, docSettingsResult, collectionToJsonApi, onError);
    } else if (collectionSettings.type === 'media') {
      const mediaSettingsResult = await LaikaTask.runPromiseResult(repo.getMediaCollectionSettings(key));
      if (Result.isFailure(mediaSettingsResult)) {
        return respondError(c, mediaSettingsResult, onError);
      }
      return respondResource(c, mediaSettingsResult, collectionToJsonApi, onError);
    }
    return respondError(c, Result.fail(new BadRequestError(`Unknown collection type`)), onError);
  });

  app.post('/collections', async c => {
    try {
      const jsonData = await c.req.json();
      const validatedData = decodeCollectionJsonApi(jsonData.data);
      const body = collectionFromJsonApi(validatedData as CollectionJsonApi);

      if (body.type === 'document') {
        const result = await LaikaTask.runPromiseResult(repo.putDocumentCollectionSettings(body.key, body));
        if (Result.isFailure(result)) {
          return respondError(c, result, onError);
        }
        return c.json({ data: collectionToJsonApi(body) }, 201);
      } else if (body.type === 'media') {
        const result = await LaikaTask.runPromiseResult(repo.putMediaCollectionSettings(body.key, body));
        if (Result.isFailure(result)) {
          return respondError(c, result, onError);
        }
        return c.json({ data: collectionToJsonApi(body) }, 201);
      }
      return respondError(c, Result.fail(new BadRequestError(`Unknown collection type`)), onError);
    } catch (error) {
      onError?.(error);
      return c.json({
        errors: [{
          status: '400',
          title: 'Invalid Request',
          detail: (error as Error).message,
        }],
      }, 400);
    }
  });

  app.patch('/collections/:key', async c => {
    try {
      const key = c.req.param('key');

      const allSettings = await LaikaTask.runPromiseResult(repo.getSettings());
      if (Result.isFailure(allSettings)) {
        return respondError(c, allSettings, onError);
      }
      const collections = allSettings.success.collections ?? {};
      if (!collections[key]) {
        return respondError(
          c,
          Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
          onError,
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
          onError,
        );
      }

      const bodyWithKey = { ...body, key };

      if (bodyWithKey.type === 'document') {
        const result = await LaikaTask.runPromiseResult(repo.putDocumentCollectionSettings(key, bodyWithKey));
        if (Result.isFailure(result)) {
          return respondError(c, result, onError);
        }
        return c.json({ data: collectionToJsonApi(bodyWithKey) });
      } else if (bodyWithKey.type === 'media') {
        const result = await LaikaTask.runPromiseResult(repo.putMediaCollectionSettings(key, bodyWithKey));
        if (Result.isFailure(result)) {
          return respondError(c, result, onError);
        }
        return c.json({ data: collectionToJsonApi(bodyWithKey) });
      }
      return respondError(c, Result.fail(new BadRequestError(`Unknown collection type`)), onError);
    } catch (error) {
      onError?.(error);
      return c.json({
        errors: [{
          status: '400',
          title: 'Invalid Request',
          detail: (error as Error).message,
        }],
      }, 400);
    }
  });

  app.delete('/collections/:key', async c => {
    const key = c.req.param('key');
    const allSettings = await LaikaTask.runPromiseResult(repo.getSettings());
    if (Result.isFailure(allSettings)) {
      return respondError(c, allSettings, onError);
    }
    const collections = allSettings.success.collections ?? {};
    const collectionSettings = collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
        onError,
      );
    }
    // Remove collection settings - create a new object without the key
    const { [key]: _, ...remainingCollections } = collections;
    const updatedSettings = {
      ...allSettings.success,
      collections: remainingCollections,
    };
    const result = await LaikaTask.runPromiseResult(repo.putSettings(updatedSettings));
    if (Result.isFailure(result)) {
      return respondError(c, result, onError);
    }
    return c.body(null, 204);
  });

  return app;
}
