import { createFileRoute } from '@tanstack/react-router';

import { Docs } from '../components/Docs';

export const Route = createFileRoute('/docs')({
  head: () => ({ meta: [{ title: 'Documentation — Laika CMS' }] }),
  component: Docs,
});
