import type { ReactNode } from 'react';

import { BackendIcon } from './BackendIcon';
import { CATALOGUE_SERIALIZERS, LAIKA_GROUPS } from './Backends';
import { IconArrow, IconGitHub, IconGlobe } from './icons';

const TAG_DOT_SHADOW = 'shadow-[0_0_0_3px_color-mix(in_oklab,oklch(0.7_0.17_150),transparent_78%)]';

const BTN_PRIMARY =
  'font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer border border-transparent whitespace-nowrap bg-indigo text-white shadow-[0_1px_2px_rgba(31,38,95,0.18),0_8px_22px_-12px_rgba(63,81,181,0.55)] transition-[background,color,border-color,transform,box-shadow] duration-150 hover:bg-indigo-700 active:translate-y-px';

const BTN_GHOST =
  'font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer whitespace-nowrap bg-surface text-ink border border-hairline-2 transition-[background,color,border-color,transform,box-shadow] duration-150 hover:border-ink-3 hover:bg-surface-2 active:translate-y-px';

/* The marquee is decorative: every backend twice so the loop is seamless. */
const marquee = [...LAIKA_GROUPS.flatMap(g => g.items), ...CATALOGUE_SERIALIZERS.items];
const loop = [...marquee, ...marquee];

interface HeroCta {
  label: string;
  href: string;
}

interface HeroProps {
  tag: string;
  headline: string;
  headlineAccent: string;
  primaryCta: HeroCta;
  secondaryCta: HeroCta;
  runtimesLabel: string;
  runtimes: string[];
  /** The lead paragraph — MDX prose, so the page slots it in. */
  children?: ReactNode;
  /** Named slot for the one island on this page: `<CodePanel client:load slot="panel" />`. */
  panel?: ReactNode;
}

export function Hero({
  tag,
  headline,
  headlineAccent,
  primaryCta,
  secondaryCta,
  runtimesLabel,
  runtimes,
  children,
  panel,
}: HeroProps) {
  return (
    <section className="relative overflow-clip pt-16 pb-[88px]">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px] grid grid-cols-[1fr_1.02fr] max-[940px]:grid-cols-1 gap-16 max-[940px]:gap-[44px] items-center relative z-[1]">
        <div className="max-[940px]:order-1">
          <div className="font-mono inline-flex items-center gap-[9px] text-[12.5px] text-ink-2 px-[13px] py-[7px] rounded-full whitespace-nowrap border border-hairline-2 bg-surface">
            <span className={`w-[7px] h-[7px] rounded-full bg-[oklch(0.7_0.17_150)] ${TAG_DOT_SHADOW}`} />
            {tag}
          </div>

          <h1 className="mt-[26px] text-[clamp(40px,6vw,74px)] leading-[0.98] tracking-[-0.035em] font-display font-semibold">
            {headline}
            <br />
            <span className="text-ink-3">{headlineAccent}</span>
          </h1>

          <div className="prose [&>p]:mt-[26px] [&>p]:text-[clamp(17px,1.55vw,20px)] [&>p]:leading-[1.6] [&>p]:text-ink-2 [&>p]:max-w-[52ch]">
            {children}
          </div>

          <div className="mt-[34px] flex gap-3.5 flex-wrap">
            <a href={primaryCta.href} className={BTN_PRIMARY}>
              {primaryCta.label} <IconArrow size={16} />
            </a>
            <a className={BTN_GHOST} href={secondaryCta.href} target="_blank" rel="noreferrer">
              <IconGitHub size={17} /> {secondaryCta.label}
            </a>
          </div>

          <div className="mt-11 flex items-center gap-[18px] flex-wrap">
            <span className="text-xs text-ink-3 inline-flex items-center gap-[7px] uppercase tracking-[0.1em] font-mono">
              <IconGlobe size={15} /> {runtimesLabel}
            </span>
            <div className="flex gap-[9px] flex-wrap">
              {runtimes.map(r => (
                <span
                  key={r}
                  className="text-[13.5px] text-ink-2 px-3 py-1.5 border border-hairline-2 rounded-lg bg-surface"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="relative min-w-0 max-[940px]:order-2">
          <img
            className="absolute w-[128%] h-[128%] max-w-none top-1/2 left-[64%] -translate-x-1/2 -translate-y-1/2 object-contain opacity-55 z-0 pointer-events-none"
            src="/assets/laika-dog-mid.png"
            alt=""
            aria-hidden="true"
          />
          {panel}
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <div className="mt-[60px] overflow-hidden marquee-mask" aria-hidden="true">
          <div className="flex gap-3.5 w-max animate-marquee motion-reduce:animate-none [&:hover]:[animation-play-state:paused]">
            {loop.map((b, i) => (
              <span
                key={`${b.name}-${i}`}
                className="w-[50px] h-[50px] rounded-[13px] grid place-items-center bg-surface border border-hairline-2 shadow-[0_4px_14px_-10px_rgba(31,38,95,0.4)] flex-none"
                title={b.name}
              >
                <BackendIcon icon={b.icon} size={26} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
