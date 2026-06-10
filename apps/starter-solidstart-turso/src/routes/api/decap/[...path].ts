import type { APIEvent } from '@solidjs/start/server';

import { laika } from '~/lib/laika.js';

const handle = (event: APIEvent) => laika.fetch(event.request);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
export const HEAD = handle;
export const OPTIONS = handle;
