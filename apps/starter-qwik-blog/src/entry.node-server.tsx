/**
 * Qwik City node-server entry — wires the SSR render fn into the Node adapter
 * so `qwik build` (build.server step) can emit dist/server/entry.node-server.js.
 *
 * The actual HTTP server is in `server/entry.node-server.js` (the compiled
 * output of this file); start it with `pnpm start`.
 */
import { createQwikCity } from '@builder.io/qwik-city/middleware/node';
import qwikCityPlan from '@qwik-city-plan';
import { manifest } from '@qwik-client-manifest';

import render from './entry.ssr';

const { router, notFound } = createQwikCity({ render, qwikCityPlan, manifest });

export default {
  router,
  notFound,
};
