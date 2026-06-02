import { laika } from '@/lib/laika';

/**
 * Proxy all HTTP methods to the embedded Laika/Decap JSON:API handler.
 *
 * Next.js App Router passes a NextRequest (which extends the platform Request)
 * so laika.fetch receives the full URL + headers + body and routes internally
 * using basePath ('/api/decap').
 */
const handler = (request: Request) => laika.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
