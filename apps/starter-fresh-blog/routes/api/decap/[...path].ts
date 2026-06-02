// Decap JSON:API proxy.
//
// Fresh 2's ctx.req IS the native WHATWG Request — identical to what
// laika.fetch expects — so we pass it directly. No bridging needed.
//
// The single-function form of define.handlers handles all HTTP methods,
// which is what we need: Decap sends GET, POST, PUT, DELETE, PATCH.
import { createDefine } from 'fresh';

import { laika } from '../../../lib/laika.ts';

const define = createDefine<Record<never, never>>();

export const handler = define.handlers(ctx => laika.fetch(ctx.req));
