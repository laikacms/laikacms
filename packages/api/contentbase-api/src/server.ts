import type { ContentBaseSettingsProvider } from '@laikacms/contentbase-settings';
import { type CollectionSettings } from '@laikacms/contentbase-settings';
import type { LaikaResult } from '@laikacms/core';
import { NotFoundError } from '@laikacms/core';
import * as Result from 'effect/Result';
import { Hono } from 'hono';
import type { Context } from 'hono';
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
    const settings = await repo.getSettings();
    if (Result.isFailure(settings)) {
      return respondError(c, settings);
    }
    const collections = settings.success.collections ?? {};
    const settingsList = Object.values(collections);
    return respondCollection(c, Result.succeed(settingsList), collectionToJsonApi);
  });

  app.get('/collections/:key', async c => {
    const key = c.req.param('key');
    const allSettings = await repo.getSettings();
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
      const docSettingsResult = await repo.getDocumentCollectionSettings(key);
      if (Result.isFailure(docSettingsResult)) {
        return respondError(c, docSettingsResult);
      }
      return respondResource(c, docSettingsResult, collectionToJsonApi);
    } else if (collectionSettings.type === 'media') {
      const mediaSettingsResult = await repo.getMediaCollectionSettings(key);
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
        const result = await repo.putDocumentCollectionSettings(body.key, body);
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(body) });
      } else if (body.type === 'media') {
        const result = await repo.putMediaCollectionSettings(body.key, body);
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
        const result = await repo.putDocumentCollectionSettings(key, bodyWithKey);
        if (Result.isFailure(result)) {
          return respondError(c, result);
        }
        return c.json({ data: collectionToJsonApi(bodyWithKey) });
      } else if (bodyWithKey.type === 'media') {
        const result = await repo.putMediaCollectionSettings(key, bodyWithKey);
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
    const allSettings = await repo.getSettings();
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
    const result = await repo.putSettings(updatedSettings);
    if (Result.isFailure(result)) {
      return respondError(c, result);
    }
    return c.body(null, 204);
  });

  return app;
}
