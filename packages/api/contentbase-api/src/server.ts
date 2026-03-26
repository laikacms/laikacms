import { Hono } from "hono";
import type { Context } from "hono";
import { StorageRepository } from "@laikacms/storage";
import { errorCode, failure, Result, success } from "@laikacms/core";
import {
  collectionToJsonApiZ,
  toJsonApi,
  collectionZ,
  collectionInsertFromJsonApiZ,
  collectionUpdateFromJsonApiZ,
} from "./jsonapi.js";
import { ContentBaseSettingsProvider } from "@laikacms/contentbase-settings";
import z from "zod";

// JSON:API error response
function respondError(
  c: Context,
  result: Result<any>,
  status: 400 | 404 | 500 = 400
) {
  return c.json(
    {
      errors: result.messages?.map((m) => ({
        status: String(status),
        title: "Validation Error",
        detail: m,
      })) ?? [
        {
          status: String(status),
          title: "Unknown Error",
          detail: "An unknown error occurred",
        },
      ],
    },
    status
  );
}

// JSON:API success response for single resource
function respondResource<T>(
  c: Context,
  result: Result<T>,
  outputSchema: ReturnType<typeof toJsonApi> | z.ZodUnion<any>
) {
  if (!result.success) {
    return respondError(c, result);
  }
  return c.json(outputSchema.parse(result.data));
}

// JSON:API success response for resource collection
function respondCollection<T>(
  c: Context,
  result: Result<readonly T[]>,
  outputSchema: ReturnType<typeof toJsonApi> | z.ZodUnion<any>
) {
  if (!result.success) {
    return respondError(c, result);
  }
  return c.json({
    data: result.data.map((item) => outputSchema.parse(item)),
  });
}

export function buildJsonApi(repo: ContentBaseSettingsProvider) {
  const app = new Hono();

  // Global error handler
  app.onError((err, c) => {
    console.error("=== CONTENTBASE API ERROR ===");
    console.error("Error type:", err.constructor.name);
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    console.error("============================");

    // Handle AWS SDK errors
    if (err.name === "NetworkingError" || err.name === "TimeoutError") {
      return c.json(
        {
          errors: [
            {
              status: "503",
              title: "Service Unavailable",
              detail: `Cannot connect to DynamoDB: ${err.message}. Check if DynamoDB Local is running and accessible.`,
            },
          ],
        },
        503
      );
    }

    throw err;
  });

  // Collections
  app.get("/collections", async (c) => {
    const settings = await repo.getSettings();
    if (!settings.success) {
      return respondError(c, settings);
    }
    const settingsList = Object.values(settings.data.collections);
    return respondCollection(c, success(settingsList), collectionZ);
  });
  app.get("/collections/:key", async (c) => {
    // TODO: This should be simplified a lot 

    const key = c.req.param("key");
    const allSettings = await repo.getSettings();
    if (!allSettings.success) {
      return respondError(c, allSettings);
    }
    const collectionSettings = allSettings.data.collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        failure(errorCode.NOT_FOUND, [`Collection '${key}' not found.`]),
        404
      );
    }
    if (!collectionSettings) {
      return respondError(
        c,
        failure(errorCode.NOT_FOUND, [`Collection '${key}' not found.`]),
        404
      );
    }
    if (collectionSettings.type === "document") {
      const docSettingsResult = await repo.getDocumentCollectionSettings(
        key
      );
      if (!docSettingsResult.success) {
        return respondError(c, docSettingsResult);
      }
      return respondResource(
        c,
        docSettingsResult,
        collectionToJsonApiZ
      );
    } else if (collectionSettings.type === "media") {
      const mediaSettingsResult = await repo.getMediaCollectionSettings(key);
      if (!mediaSettingsResult.success) {
        return respondError(c, mediaSettingsResult);
      }
      return respondResource(
        c,
        mediaSettingsResult,
        collectionToJsonApiZ
      );
    }
  });
  app.post("/collections", async (c) => {
    // TODO: This should be simplified a lot 
    const body = collectionInsertFromJsonApiZ.parse(await c.req.json());
    if (body.type === 'document') {
      return respondResource(
        c,
        await repo.putDocumentCollectionSettings(body.key, body),
        collectionToJsonApiZ
      );
    } else if (body.type === 'media') {
      return respondResource(
        c,
        await repo.putMediaCollectionSettings(body.key, body),
        collectionToJsonApiZ
      );
    }
  });
  app.patch("/collections/:key", async (c) => {
    // TODO: This should be simplified a lot 
    const key = c.req.param("key");
    const body = collectionUpdateFromJsonApiZ.parse(await c.req.json());
    if (body.type === 'document') {
      return respondResource(
        c,
        await repo.putDocumentCollectionSettings(key, body),
        collectionToJsonApiZ
      );
    } else if (body.type === 'media') {
      return respondResource(
        c,
        await repo.putMediaCollectionSettings(key, body),
        collectionToJsonApiZ
      );
    }
  });
  app.delete("/collections/:key", async (c) => {
    // TODO: This should be simplified a lot 
    const key = c.req.param("key");
    const allSettings = await repo.getSettings();
    if (!allSettings.success) {
      return respondError(c, allSettings);
    }
    const collectionSettings = allSettings.data.collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        failure(errorCode.NOT_FOUND, [`Collection '${key}' not found.`]),
        404
      );
    }
    // Remove collection settings
    delete allSettings.data.collections[key];
    const result = await repo.putSettings(allSettings.data);
    if (!result.success) {
      return respondError(c, result);
    }
    return c.status(204);
  });

  return app;
}
