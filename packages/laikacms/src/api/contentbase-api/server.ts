import * as Result from 'effect/Result';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import { type CollectionSettings } from 'laikacms/contentbase-settings';
import type { LaikaResult } from 'laikacms/core';
import { NotFoundError } from 'laikacms/core';

async function firstResult<T>(gen: AsyncGenerator<LaikaResult<T>>): Promise<LaikaResult<T>> {
  for await (const result of gen) return result;
  return Result.fail(new NotFoundError('No result'));
}
import {
  collectionFromJsonApi,
  type CollectionJsonApi,
  collectionToJsonApi,
  decodeCollectionJsonApi,
} from './jsonapi.js';

// JSON:API error response
function respondError(
  c: Context,
  result: LaikaResult<unknown>,
  status: 400 | 404 | 500 = 400,
) {
  if (Result.isFailure(result)) {
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
          status: String(status),
          title: 'Unknown Error',
          detail: 'An unknown error occurred',
        },
      ],
    },
    status,
  );
}

// JSON:API success response for single resource
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
export function buildJsonApi(repo: ContentBaseSettingsProvider) {
  const app = new Hono();

  // Global error handler
  app.onError((err, c) => {
    console.error('=== CONTENTBASE API ERROR ===');
    console.error('Error type:', err.constructor.name);
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    console.error('============================');

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

  // Collections
  app.get('/collections', async c => {
    const settings = await firstResult(repo.getSettings());
    if (Result.isFailure(settings)) {
      return respondError(c, settings);
    }
    const collections = settings.success.collections ?? {};
    const settingsList = Object.values(collections);
    return respondCollection(c, Result.succeed(settingsList), collectionToJsonApi);
  });

  app.get('/collections/:key', async c => {
    const key = c.req.param('key');
    const allSettings = await firstResult(repo.getSettings());
    if (Result.isFailure(allSettings)) {
      return respondError(c, allSettings);
    }
    const collections = allSettings.success.collections ?? {};
    const collectionSettings = collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
        404,
      );
    }
    if (collectionSettings.type === 'document') {
      const docSettingsResult = await firstResult(repo.getDocumentCollectionSettings(key));
      if (Result.isFailure(docSettingsResult)) {
        return respondError(c, docSettingsResult);
      }
      return respondResource(c, docSettingsResult, collectionToJsonApi);
    } else if (collectionSettings.type === 'media') {
      const mediaSettingsResult = await firstResult(repo.getMediaCollectionSettings(key));
      if (Result.isFailure(mediaSettingsResult)) {
        return respondError(c, mediaSettingsResult);
      }
      return respondResource(c, mediaSettingsResult, collectionToJsonApi);
    }
    return respondError(c, Result.fail(new NotFoundError(`Unknown collection type`)), 400);
  });

  app.post('/collections', async c => {
    try {
      const jsonData = await c.req.json();
      const validatedData = decodeCollectionJsonApi(jsonData.data);
      const body = collectionFromJsonApi(validatedData as CollectionJsonApi);

      if (body.type === 'document') {
        const result = await firstResult(repo.putDocumentCollectionSettings(body.key, body));
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(body) });
      } else if (body.type === 'media') {
        const result = await firstResult(repo.putMediaCollectionSettings(body.key, body));
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(body) });
      }
      return respondError(c, Result.fail(new NotFoundError(`Unknown collection type`)), 400);
    } catch (error) {
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
      const jsonData = await c.req.json();
      const validatedData = decodeCollectionJsonApi(jsonData.data);
      const body = collectionFromJsonApi(validatedData as CollectionJsonApi);

      // Ensure the key matches
      const bodyWithKey = { ...body, key };

      if (bodyWithKey.type === 'document') {
        const result = await firstResult(repo.putDocumentCollectionSettings(key, bodyWithKey));
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(bodyWithKey) });
      } else if (bodyWithKey.type === 'media') {
        const result = await firstResult(repo.putMediaCollectionSettings(key, bodyWithKey));
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(bodyWithKey) });
      }
      return respondError(c, Result.fail(new NotFoundError(`Unknown collection type`)), 400);
    } catch (error) {
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
    const allSettings = await firstResult(repo.getSettings());
    if (Result.isFailure(allSettings)) {
      return respondError(c, allSettings);
    }
    const collections = allSettings.success.collections ?? {};
    const collectionSettings = collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
        404,
      );
    }
    // Remove collection settings - create a new object without the key
    const { [key]: _, ...remainingCollections } = collections;
    const updatedSettings = {
      ...allSettings.success,
      collections: remainingCollections,
    };
    const result = await firstResult(repo.putSettings(updatedSettings));
    if (Result.isFailure(result)) {
      return respondError(c, result);
    }
    return c.body(null, 204);
  });

  return app;
}
