import type { ReactNode } from 'react';

/* The grid the pillars sit in. It is a component the MDX uses rather than a
   wrapper around `<Body>`, because the lead paragraph and the cards are both in
   the body — the content decides where the grid starts. */
export function PillarGrid({ children }: { children?: ReactNode }) {
  return (
    <div className="mt-[52px] grid grid-cols-3 max-[920px]:grid-cols-2 max-[620px]:grid-cols-1 gap-[22px]">
      {children}
    </div>
  );
}
