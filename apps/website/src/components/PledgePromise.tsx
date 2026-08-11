import type { ReactNode } from 'react';

import { IconBan, IconCheck, IconSpark } from './icons';

/* Content names an icon; the glyph itself stays in code. */
const ICONS = { check: IconCheck, spark: IconSpark, ban: IconBan };

interface PledgePromiseProps {
  icon: keyof typeof ICONS;
  title: string;
  children?: ReactNode;
}

/* The MDX body calls this `<Promise>`; the export is prefixed so the module
   never shadows the global of that name. See `content/pledge.mdx`. */
export function PledgePromise({ icon, title, children }: PledgePromiseProps) {
  const Glyph = ICONS[icon];

  return (
    <div className="px-[26px] py-[28px] border rounded-[14px] bg-surface border-hairline">
      <span className="inline-grid place-items-center w-11 h-11 rounded-[11px] text-accent border border-indigo-tint-2 bg-surface">
        <Glyph size={19} />
      </span>
      <h3 className="text-[20px] mt-[18px] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
        {title}
      </h3>
      <div className="[&>p]:mt-2.5 [&>p]:text-ink-2 [&>p]:text-[15px] [&>p]:leading-[1.6]">
        {children}
      </div>
    </div>
  );
}
