import { serve } from "@hono/node-server";
import { buildJsonApi } from '../src/index'
import { StorageRepository } from "@laikacms/storage";

type JsonApiDeps = StorageRepository // TODO: Add more deps

export function startServer(
  deps: JsonApiDeps,
  port = Number(process.env.PORT) || 4000
) {
  const app = buildJsonApi(deps);
  console.log(`[json-api] Starting server on :${port}`);
  serve({ fetch: app.fetch, port });
  return app;
}
