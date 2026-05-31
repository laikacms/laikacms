import type { APIEvent } from '@solidjs/start/server';

import { laika } from '~/server/laika';

const handler = ({ request }: APIEvent) => laika.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
