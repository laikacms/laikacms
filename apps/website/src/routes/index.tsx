import { createFileRoute } from '@tanstack/react-router';

import { Compare } from '../components/Compare';
import { Features } from '../components/Features';
import { Hero } from '../components/Hero';
import { Pledge } from '../components/Pledge';

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'Laika CMS: one content API, any backend' }] }),
  component: FeaturesView,
});

function FeaturesView() {
  return (
    <>
      <Hero />
      <Features />
      <Compare />
      <Pledge />
    </>
  );
}
