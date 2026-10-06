import type { ReactNode } from 'react';

interface FeaturesProps {
  heading: string;
  /** The lead paragraph and the pillar grid — MDX prose slotted in by the page. */
  children?: ReactNode;
}

export function Features({ heading, children }: FeaturesProps) {
  return (
    <section className="border-t border-hairline py-28 max-[760px]:py-[76px] relative">
      <div className="site-container">
        <h2 className="text-[clamp(32px,4.2vw,50px)] max-w-[18ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          {heading}
        </h2>
        <div className="prose [&>p]:mt-[22px] [&>p]:text-[clamp(17px,1.5vw,20px)] [&>p]:text-ink-2 [&>p]:max-w-[56ch] [&>p]:leading-[1.55]">
          {children}
        </div>
      </div>
    </section>
  );
}
