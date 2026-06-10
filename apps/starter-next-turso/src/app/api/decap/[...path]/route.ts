import { laika } from '@/lib/laika';

const handler = (request: Request) => laika.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
