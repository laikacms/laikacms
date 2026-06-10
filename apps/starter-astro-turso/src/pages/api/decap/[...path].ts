import type { APIRoute } from 'astro';

import { laika } from '../../../laika.js';

const handler: APIRoute = ({ request }) => laika.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
