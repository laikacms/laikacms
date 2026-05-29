import { createFileRoute } from '@tanstack/react-router';

import { Docs } from '../components/Docs';

export const Route = createFileRoute('/docs')({
  component: Docs,
});
