import type { ReactNode } from 'react';

import { IconBan, IconCheck, IconSpark } from './icons';

/* The Forestry story is the emotional core of this section: the git CMS we
   loved went fully commercial and then disappeared. The pledge exists so
   adopters know that failure mode is designed out of Laika. */

interface Promise_ {
  icon: ReactNode;
  t: string;
  d: string;
}

const PROMISES: Promise_[] = [
  {
    icon: <IconCheck size={19} />,
    t: 'Free, forever',
    d: 'The complete CMS: content modeling, the JSON:API, every storage backend, the dashboard, the Decap bridge, auth. If you need it to run Laika in production, it is MIT.',
  },
  {
    icon: <IconSpark size={19} />,
    t: 'Paid, eventually',
    d: 'A hosted platform and AI-assisted authoring: conveniences that save you time and raise productivity. Everything paid is something you could self-host or simply skip.',
  },
  {
    icon: <IconBan size={19} />,
    t: 'Never',
    d: 'Features moved behind a paywall after you adopted them. An enterprise edition. Rent charged on access to your own content.',
  },
];

export function Pledge() {
  return (
    <section className="border-t border-hairline py-28 max-[760px]:py-[76px]">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <span className="font-mono text-[12.5px] tracking-[0.12em] uppercase text-indigo font-medium inline-flex items-center gap-[9px] whitespace-nowrap before:content-[''] before:w-[22px] before:h-[1.5px] before:bg-indigo before:inline-block">
          Why this exists
        </span>
        <h2 className="text-[clamp(32px,4.2vw,50px)] mt-5 max-w-[22ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          Open source. Not open-core, not for-now. Forever.
        </h2>
        <p className="mt-[22px] text-[clamp(17px,1.5vw,20px)] text-ink-2 max-w-[58ch] leading-[1.55]">
          Laika is inspired by Forestry, the git-backed CMS that made content feel effortless, until it went fully
          commercial and then shut down, taking a generation of workflows with it. That is the failure mode this project
          is built to rule out: a tool you build on should not be able to change its mind about you.
        </p>

        <div className="mt-[52px] grid grid-cols-3 max-[920px]:grid-cols-1 gap-[22px]">
          {PROMISES.map(p => (
            <div key={p.t} className="px-[26px] py-[28px] border rounded-[14px] bg-surface border-hairline">
              <span className="inline-grid place-items-center w-11 h-11 rounded-[11px] text-indigo border border-indigo-tint-2 bg-surface">
                {p.icon}
              </span>
              <h3 className="text-[20px] mt-[18px] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
                {p.t}
              </h3>
              <p className="mt-2.5 text-ink-2 text-[15px] leading-[1.6]">{p.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
