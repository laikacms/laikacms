/**
 * Decap JSON:API catch-all — proxies all methods to laika.fetch.
 *
 * In HonoX, exporting a Hono instance as `default` registers it as a sub-app
 * at this route, letting us use app.all('*', ...) to handle every HTTP method.
 *
 * Doc note: c.req.raw is the Web API Request — laika.fetch accepts it directly.
 * No IncomingMessage→Request bridge needed (Hono/HonoX is web-API-first).
 */
import { createHono } from 'honox/factory';

import { laika } from '../../../../src/laika.js';

const app = createHono();

app.all('*', c => laika.fetch(c.req.raw));

export default app;
