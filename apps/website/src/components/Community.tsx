import type { ReactNode } from 'react';
import { Children, isValidElement } from 'react';

import { Backends } from './Backends';
import { IconArrow, IconArrowUpRight, IconBolt, IconGitHub, IconPlug } from './icons';

const ICONS = { github: IconGitHub, plug: IconPlug, arrow: IconArrow, bolt: IconBolt };

interface CardProps {
  icon: keyof typeof ICONS;
  title: string;
  blurb: string;
  href: string;
}

export function Card({ icon, title, blurb, href }: CardProps) {
  const Glyph = ICONS[icon];
  return (
    <a
      className="flex gap-3.5 items-start p-[22px] border border-hairline rounded-[14px] bg-surface transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-[3px] hover:border-hairline-2 hover:shadow-lift"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <span className="text-accent flex-none mt-0.5">
        <Glyph size={18} />
      </span>
      <span className="flex flex-col gap-[5px]">
        <span className="font-display font-semibold text-base inline-flex items-center gap-1.5 tracking-[-0.02em] leading-[1.05]">
          {title} <IconArrowUpRight size={14} />
        </span>
        <span className="text-xs text-ink-3 font-mono">{blurb}</span>
      </span>
    </a>
  );
}

interface CommunityProps {
  eyebrow: string;
  heading: string;
  involveHeading: string;
  children?: ReactNode;
}

export function Community({ eyebrow, heading, involveHeading, children }: CommunityProps) {
  const childArray = Children.toArray(children);
  const cards = childArray.filter(child => isValidElement(child) && child.type === Card);
  const prose = childArray.filter(child => !(isValidElement(child) && child.type === Card));

  return (
    <section className="py-28 max-[760px]:py-[76px] relative">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <span className="font-mono text-[12.5px] tracking-[0.12em] uppercase text-accent font-medium inline-flex items-center gap-[9px] whitespace-nowrap before:content-[''] before:w-[22px] before:h-[1.5px] before:bg-accent before:inline-block">
          {eyebrow}
        </span>
        <h2 className="text-[clamp(32px,4.2vw,50px)] mt-5 max-w-[18ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          {heading}
        </h2>
        <div className="prose [&>p]:mt-[22px] [&>p]:text-[clamp(17px,1.5vw,20px)] [&>p]:text-ink-2 [&>p]:max-w-[56ch] [&>p]:leading-[1.55]">
          {prose}
        </div>

        <Backends />

        <div className="mt-16 pt-11 border-t border-hairline">
          <h3 className="font-display font-semibold text-2xl tracking-[-0.02em] leading-[1.05]">
            {involveHeading}
          </h3>
          <div className="mt-[22px] grid grid-cols-4 max-[880px]:grid-cols-2 gap-4">
            {cards}
          </div>
        </div>
      </div>
    </section>
  );
}
