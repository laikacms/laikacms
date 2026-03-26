import { serve } from "@hono/node-server";
import { buildJsonApi } from '../src/index'
import { DefaultContentBaseSettingsProvider } from "@laikacms/contentbase-settings-default";

type JsonApiDeps = DefaultContentBaseSettingsProvider // TODO: Add more deps

export function startServer(
  deps: JsonApiDeps,
  port = Number(process.env.PORT) || 4000
) {
  const app = buildJsonApi(deps);
  console.log(`[json-api] Starting server on :${port}`);
  serve({ fetch: app.fetch, port });
  return app;
}
