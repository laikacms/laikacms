// SSR — the Decap JSON:API must be live (not prerendered).
export const prerender = false;

import type { APIRoute } from 'astro';
import { laika } from '../../../lib/laika.js';

const handler: APIRoute = ({ request }) => laika.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
