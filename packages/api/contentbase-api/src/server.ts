import { Hono } from "hono";
import type { Context } from "hono";
import { StorageRepository } from "@laikacms/storage";
import { LaikaResult, LaikaError, NotFoundError } from "@laikacms/core";
import * as Result from "effect/Result";
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
  result: LaikaResult<any>,
  status: 400 | 404 | 500 = 400
) {
  if (Result.isFailure(result)) {
    return c.json(
      {
        errors: [
          {
            status: String(status),
            title: result.failure.code || "Error",
            detail: result.failure.message,
          },
        ],
      },
      status
    );
  }
  return c.json(
    {
      errors: [
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
  result: LaikaResult<T>,
  outputSchema: ReturnType<typeof toJsonApi> | z.ZodUnion<any>
) {
  if (Result.isFailure(result)) {
    return respondError(c, result);
  }
  return c.json(outputSchema.parse(result.success));
}

// JSON:API success response for resource collection
function respondCollection<T>(
  c: Context,
  result: LaikaResult<readonly T[]>,
  outputSchema: ReturnType<typeof toJsonApi> | z.ZodUnion<any>
) {
  if (Result.isFailure(result)) {
    return respondError(c, result);
  }
  return c.json({
    data: result.success.map((item) => outputSchema.parse(item)),
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
    if (Result.isFailure(settings)) {
      return respondError(c, settings);
    }
    const settingsList = Object.values(settings.success.collections);
    return respondCollection(c, Result.succeed(settingsList), collectionZ);
  });
  app.get("/collections/:key", async (c) => {
    // TODO: This should be simplified a lot 

    const key = c.req.param("key");
    const allSettings = await repo.getSettings();
    if (Result.isFailure(allSettings)) {
      return respondError(c, allSettings);
    }
    const collectionSettings = allSettings.success.collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
        404
      );
    }
    if (collectionSettings.type === "document") {
      const docSettingsResult = await repo.getDocumentCollectionSettings(
        key
      );
      if (Result.isFailure(docSettingsResult)) {
        return respondError(c, docSettingsResult);
      }
      return respondResource(
        c,
        docSettingsResult,
        collectionToJsonApiZ
      );
    } else if (collectionSettings.type === "media") {
      const mediaSettingsResult = await repo.getMediaCollectionSettings(key);
      if (Result.isFailure(mediaSettingsResult)) {
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
    if (Result.isFailure(allSettings)) {
      return respondError(c, allSettings);
    }
    const collectionSettings = allSettings.success.collections[key];
    if (!collectionSettings) {
      return respondError(
        c,
        Result.fail(new NotFoundError(`Collection '${key}' not found.`)),
        404
      );
    }
    // Remove collection settings
    delete allSettings.success.collections[key];
    const result = await repo.putSettings(allSettings.success);
    if (Result.isFailure(result)) {
      return respondError(c, result);
    }
    return c.status(204);
  });

  return app;
}
