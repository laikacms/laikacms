import { serve } from '@hono/node-server';
import { buildJsonApi, type StorageApiOptions } from '../src/index';

export function startServer(
  options: StorageApiOptions,
  port = Number(process.env.PORT) || 4000,
) {
  const app = buildJsonApi(options);
  console.log(`[json-api] Starting server on :${port}`);
  serve({ fetch: app.fetch, port });
  return app;
}
