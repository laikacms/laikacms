import { createDefine } from 'fresh';

import { ADMIN_HTML } from '../../lib/laika.ts';

const define = createDefine<Record<never, never>>();

export const handler = define.handlers({
  GET: _ctx =>
    new Response(ADMIN_HTML, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
});
