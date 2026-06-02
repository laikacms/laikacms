/**
 * Decap JSON:API proxy — forward all /api/decap/* requests to laika.fetch.
 *
 * TanStack Start server routes receive a Web API Request directly, which is
 * exactly what laika.fetch expects. The ANY method handler covers all HTTP
 * methods that Decap CMS uses (GET, POST, PUT, DELETE).
 */
import { createFileRoute } from '@tanstack/react-router';

import { laika } from '../../../laika.js';

export const Route = createFileRoute('/api/decap/$')({
  server: {
    handlers: {
      ANY: ({ request }) => laika.fetch(request),
    },
  },
});
