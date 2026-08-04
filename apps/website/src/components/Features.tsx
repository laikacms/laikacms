import type { ReactNode } from 'react';

interface FeaturesProps {
  eyebrow: string;
  heading: string;
  /** The lead paragraph and the pillar grid — MDX prose slotted in by the page. */
  children?: ReactNode;
}

export function Features({ eyebrow, heading, children }: FeaturesProps) {
  return (
    <section className="border-t border-hairline py-28 max-[760px]:py-[76px] relative">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <span className="font-mono text-[12.5px] tracking-[0.12em] uppercase text-indigo font-medium inline-flex items-center gap-[9px] whitespace-nowrap before:content-[''] before:w-[22px] before:h-[1.5px] before:bg-indigo before:inline-block">
          {eyebrow}
        </span>
        <h2 className="text-[clamp(32px,4.2vw,50px)] mt-5 max-w-[18ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          {heading}
        </h2>
        <div className="prose [&>p]:mt-[22px] [&>p]:text-[clamp(17px,1.5vw,20px)] [&>p]:text-ink-2 [&>p]:max-w-[56ch] [&>p]:leading-[1.55]">
          {children}
        </div>
      </div>
    </section>
  );
}
