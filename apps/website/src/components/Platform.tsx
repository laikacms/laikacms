import type { ReactNode } from 'react';

import { IconArrow, IconGitHub } from './icons';

const BTN_PRIMARY =
  'font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer border border-transparent whitespace-nowrap bg-indigo text-white shadow-[0_1px_2px_rgba(31,38,95,0.18),0_8px_22px_-12px_rgba(63,81,181,0.55)] transition-[background,color,border-color,transform,box-shadow] duration-150 hover:bg-indigo-700 active:translate-y-px';

const BTN_GHOST =
  'font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer whitespace-nowrap bg-surface text-ink border border-hairline-2 transition-[background,color,border-color,transform,box-shadow] duration-150 hover:border-ink-3 hover:bg-surface-2 active:translate-y-px';

interface PlatformCta {
  label: string;
  href: string;
}

interface PlatformProps {
  badge: string;
  heading: string;
  headingSecondLine: string;
  primaryCta: PlatformCta;
  secondaryCta: PlatformCta;
  children?: ReactNode;
}

export function Platform({
  badge,
  heading,
  headingSecondLine,
  primaryCta,
  secondaryCta,
  children,
}: PlatformProps) {
  return (
    <section className="py-28 max-[760px]:py-[76px] relative min-h-[70vh] grid place-items-center text-center">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <div className="max-w-[760px] mx-auto flex flex-col items-center">
          <span className="font-mono text-xs tracking-[0.1em] uppercase text-indigo bg-indigo-tint border border-indigo-tint-2 px-3.5 py-[7px] rounded-full">
            {badge}
          </span>
          <h2 className="mt-6 text-[clamp(34px,5vw,56px)] tracking-[-0.03em] font-display font-semibold leading-[1.05]">
            {heading}
            <br />
            {headingSecondLine}
          </h2>
          <div className="prose [&>p]:mt-[22px] [&>p]:text-[clamp(16px,1.5vw,19px)] [&>p]:text-ink-2 [&>p]:leading-[1.6] [&>p]:max-w-[60ch]">
            {children}
          </div>
          <div className="mt-[34px] flex gap-3.5 flex-wrap justify-center">
            <a className={BTN_PRIMARY} href={primaryCta.href} target="_blank" rel="noreferrer">
              <IconGitHub size={17} /> {primaryCta.label}
            </a>
            <a className={BTN_GHOST} href={secondaryCta.href} target="_blank" rel="noreferrer">
              {secondaryCta.label} <IconArrow size={16} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
