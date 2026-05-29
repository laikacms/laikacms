import { Link } from '@tanstack/react-router';

import { LAIKA_GROUPS, LAIKA_RUNTIMES, LAIKA_SERIALIZERS, REPO, type BackendItem } from '../data';
import { CodePanel } from './CodePanel';
import { BackendIcon, IconArrow, IconGitHub, IconGlobe } from './icons';

const HERO_LEAD =
  'Laika CMS is modular, runtime-agnostic content management. Define your content once and back it with the filesystem, object storage, a Git repo, any SQL database, Notion, a graph store — 40+ backends in all — served as a JSON:API that runs anywhere fetch runs.';

function allBackends(): BackendItem[] {
  return LAIKA_GROUPS.flatMap((g) => g.items);
}

const TAG_DOT_SHADOW = 'shadow-[0_0_0_3px_color-mix(in_oklab,oklch(0.7_0.17_150),transparent_78%)]';

const HeadlineTag = () => (
  <div className="font-mono inline-flex items-center gap-[9px] text-[12.5px] text-ink-2 px-[13px] py-[7px] rounded-full whitespace-nowrap border border-hairline-2 bg-surface">
    <span className={`w-[7px] h-[7px] rounded-full bg-[oklch(0.7_0.17_150)] ${TAG_DOT_SHADOW}`} />
    MIT licensed · open source · self-hostable
  </div>
);

const BTN_PRIMARY =
  'font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer border border-transparent whitespace-nowrap bg-indigo text-white shadow-[0_1px_2px_rgba(31,38,95,0.18),0_8px_22px_-12px_rgba(63,81,181,0.55)] transition-[background,color,border-color,transform,box-shadow] duration-150 hover:bg-indigo-700 active:translate-y-px';

const BTN_GHOST =
  'font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer whitespace-nowrap bg-surface text-ink border border-hairline-2 transition-[background,color,border-color,transform,box-shadow] duration-150 hover:border-ink-3 hover:bg-surface-2 active:translate-y-px';

const HeroCtas = () => (
  <div className="mt-[34px] flex gap-3.5 flex-wrap">
    <Link to="/docs" className={BTN_PRIMARY}>
      Get started <IconArrow size={16} />
    </Link>
    <a className={BTN_GHOST} href={REPO} target="_blank" rel="noreferrer">
      <IconGitHub size={17} /> View source
    </a>
  </div>
);

const RuntimeRow = () => (
  <div className="mt-11 flex items-center gap-[18px] flex-wrap">
    <span className="text-xs text-ink-3 inline-flex items-center gap-[7px] uppercase tracking-[0.1em] font-mono">
      <IconGlobe size={15} /> runs in
    </span>
    <div className="flex gap-[9px] flex-wrap">
      {LAIKA_RUNTIMES.map((r) => (
        <span
          key={r}
          className="text-[13.5px] text-ink-2 px-3 py-1.5 border border-hairline-2 rounded-lg bg-surface"
        >
          {r}
        </span>
      ))}
    </div>
  </div>
);

function BackendMarquee() {
  const items = [...allBackends(), ...LAIKA_SERIALIZERS];
  const loop = [...items, ...items];
  return (
    <div className="mt-[60px] overflow-hidden marquee-mask" aria-hidden="true">
      <div className="flex gap-3.5 w-max animate-marquee motion-reduce:animate-none [&:hover]:[animation-play-state:paused]">
        {loop.map((b, i) => (
          <span
            key={b.name + i}
            className="w-[50px] h-[50px] rounded-[13px] grid place-items-center bg-surface border border-hairline-2 shadow-[0_4px_14px_-10px_rgba(31,38,95,0.4)] flex-none"
            title={b.name}
          >
            <BackendIcon icon={b.icon} size={26} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-clip pt-16 pb-[88px]">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px] grid grid-cols-[1fr_1.02fr] max-[940px]:grid-cols-1 gap-16 max-[940px]:gap-[44px] items-center relative z-[1]">
        <div className="max-[940px]:order-1">
          <HeadlineTag />
          <h1 className="mt-[26px] text-[clamp(40px,6vw,74px)] leading-[0.98] tracking-[-0.035em] font-display font-semibold">
            One content API.
            <br />
            <span className="text-ink-3">40+ swappable backends.</span>
          </h1>
          <p className="mt-[26px] text-[clamp(17px,1.55vw,20px)] leading-[1.6] text-ink-2 max-w-[52ch]">
            {HERO_LEAD}
          </p>
          <HeroCtas />
          <RuntimeRow />
        </div>
        <div className="relative max-[940px]:order-2">
          <img
            className="absolute w-[128%] h-[128%] max-w-none top-1/2 left-[64%] -translate-x-1/2 -translate-y-1/2 object-contain opacity-55 z-0 pointer-events-none"
            src="/assets/laika-dog-mid.png"
            alt=""
            aria-hidden="true"
          />
          <CodePanel />
        </div>
      </div>
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <BackendMarquee />
      </div>
    </section>
  );
}
