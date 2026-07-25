import { createFileRoute } from '@tanstack/react-router';

import { Platform } from '../components/Platform';

export const Route = createFileRoute('/platform')({
  head: () => ({ meta: [{ title: 'Platform | Laika CMS' }] }),
  component: Platform,
});
