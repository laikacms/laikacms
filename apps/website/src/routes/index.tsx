import { createFileRoute } from '@tanstack/react-router';

import { Features } from '../components/Features';
import { Hero } from '../components/Hero';

export const Route = createFileRoute('/')({
  component: FeaturesView,
});

function FeaturesView() {
  return (
    <>
      <Hero />
      <Features />
    </>
  );
}
