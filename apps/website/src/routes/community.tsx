import { createFileRoute } from '@tanstack/react-router';

import { Community } from '../components/Community';

export const Route = createFileRoute('/community')({
  head: () => ({ meta: [{ title: 'Community & backends — Laika CMS' }] }),
  component: Community,
});
