import type { ReactNode } from 'react';

/* The three pledge columns. See PillarGrid for why the grid is a component. */
export function PromiseGrid({ children }: { children?: ReactNode }) {
  return <div className="mt-[52px] grid grid-cols-3 max-[920px]:grid-cols-1 gap-[22px]">{children}</div>;
}
