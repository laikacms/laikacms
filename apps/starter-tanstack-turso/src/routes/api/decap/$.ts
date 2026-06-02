import { createFileRoute } from '@tanstack/react-router';

import { laika } from '../../../laika.js';

export const Route = createFileRoute('/api/decap/$')({
  server: {
    handlers: {
      ANY: ({ request }) => laika.fetch(request),
    },
  },
});
