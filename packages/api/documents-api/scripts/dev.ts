import { serve } from '@hono/node-server';
import { buildJsonApi, type DocumentsApiOptions } from '../src/index';

export function startServer(
  options: DocumentsApiOptions,
  port = Number(process.env.PORT) || 4000,
) {
  const app = buildJsonApi(options);
  console.log(`[json-api] Starting server on :${port}`);
  serve({ fetch: app.fetch, port });
  return app;
}
