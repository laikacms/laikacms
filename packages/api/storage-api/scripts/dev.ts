import { serve } from '@hono/node-server';
import type { StorageRepository } from '@laikacms/storage';
import { buildJsonApi } from '../src/index';

type JsonApiDeps = StorageRepository; // TODO: Add more deps

export function startServer(
  deps: JsonApiDeps,
  port = Number(process.env.PORT) || 4000,
) {
  const app = buildJsonApi(deps);
  console.log(`[json-api] Starting server on :${port}`);
  serve({ fetch: app.fetch, port });
  return app;
}
