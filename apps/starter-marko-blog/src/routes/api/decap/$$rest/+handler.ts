import { laika } from '../../../../server/laika';

// Catch-all (`$$rest` in Marko Run): forward every method through laika.fetch.
const handler = ({ request }: { request: Request }) => laika.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
