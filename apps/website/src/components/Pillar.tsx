import type { ReactNode } from 'react';

import {
  IconBook,
  IconCube,
  IconGlobe,
  IconLayers,
  IconLayout,
  IconPlug,
  IconScales,
  IconSpark,
  IconSwap,
} from './icons';

/* Content names an icon; the glyph itself stays in code. */
const ICONS = {
  scales: IconScales,
  layers: IconLayers,
  swap: IconSwap,
  layout: IconLayout,
  globe: IconGlobe,
  cube: IconCube,
  book: IconBook,
  spark: IconSpark,
  plug: IconPlug,
};

interface PillarProps {
  icon: keyof typeof ICONS;
  title: string;
  /** A pillar with a badge is the featured one — tinted card, white icon well. */
  badge?: string;
  children?: ReactNode;
}

export function Pillar({ icon, title, badge, children }: PillarProps) {
  const Glyph = ICONS[icon];

  const card = badge
    ? 'relative px-[26px] py-[28px] border rounded-[14px] bg-indigo-tint border-indigo-tint-3'
    : 'relative px-[26px] py-[28px] border rounded-[14px] bg-surface border-hairline';

  return (
    <div className={card}>
      <span
        className={'inline-grid place-items-center w-11 h-11 rounded-[11px] text-accent border border-indigo-tint-2 '
          + (badge ? 'bg-well' : 'bg-surface')}
      >
        <Glyph size={20} />
      </span>
      <h3 className="text-[20px] mt-[18px] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
        {title}
      </h3>
      <div className="[&>p]:mt-2.5 [&>p]:text-ink-2 [&>p]:text-[15px] [&>p]:leading-[1.6]">
        {children}
      </div>
      {badge && (
        <span className="absolute top-[22px] right-[22px] text-[11px] tracking-[0.08em] text-white bg-indigo px-[9px] py-[3px] rounded-md font-mono">
          {badge}
        </span>
      )}
    </div>
  );
}
