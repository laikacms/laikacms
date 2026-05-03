import { serve } from '@hono/node-server';
import type { ContentBaseSettingsProvider } from '@laikacms/contentbase-settings';
import { buildJsonApi } from '../src/index';

export function startServer(
  repo: ContentBaseSettingsProvider,
  port = Number(process.env.PORT) || 4000,
) {
  const app = buildJsonApi(repo);
  console.log(`[json-api] Starting server on :${port}`);
  serve({ fetch: app.fetch, port });
  return app;
}
