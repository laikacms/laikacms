import type { ReactNode } from 'react';

import { REPO } from '../data';
import { Backends } from './Backends';
import { IconArrow, IconArrowUpRight, IconBolt, IconGitHub, IconPlug } from './icons';

interface InvolveCard {
  t: string;
  d: string;
  href: string;
  ic: ReactNode;
}

const CARDS: InvolveCard[] = [
  { t: 'Repository', d: 'laikacms/laikacms', href: REPO, ic: <IconGitHub size={18} /> },
  {
    t: 'Contributing',
    d: 'Set up the workspace, send a PR',
    href: REPO + '/blob/develop/CONTRIBUTING.md',
    ic: <IconPlug size={18} />,
  },
  {
    t: 'Roadmap',
    d: "What's planned, in the open",
    href: REPO + '/blob/develop/ROADMAP.md',
    ic: <IconArrow size={18} />,
  },
  { t: 'Issues', d: 'Bugs, ideas, discussions', href: REPO + '/issues', ic: <IconBolt size={18} /> },
];

export function Community() {
  return (
    <section className="py-28 max-[760px]:py-[76px] relative">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <span className="font-mono text-[12.5px] tracking-[0.12em] uppercase text-indigo font-medium inline-flex items-center gap-[9px] whitespace-nowrap before:content-[''] before:w-[22px] before:h-[1.5px] before:bg-indigo before:inline-block">
          Community
        </span>
        <h2 className="text-[clamp(32px,4.2vw,50px)] mt-5 max-w-[18ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          40+ backends, two contracts, one content API.
        </h2>
        <p className="mt-[22px] text-[clamp(17px,1.5vw,20px)] text-ink-2 max-w-[56ch] leading-[1.55]">
          The storage layer is where Laika is most extensible. Every tile below is a real StorageRepository that ships
          today — buckets, SQL, Git, document stores, search indexes, Notion, a graph database. Adapters are small; an
          author can add the next one.
        </p>

        <Backends />

        <div className="mt-16 pt-11 border-t border-hairline">
          <h3 className="font-display font-semibold text-2xl tracking-[-0.02em] leading-[1.05]">
            Get involved
          </h3>
          <div className="mt-[22px] grid grid-cols-4 max-[880px]:grid-cols-2 gap-4">
            {CARDS.map(c => (
              <a
                key={c.t}
                className="flex gap-3.5 items-start p-[22px] border border-hairline rounded-[14px] bg-surface transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-[3px] hover:border-hairline-2 hover:shadow-[0_14px_30px_-18px_rgba(31,38,95,0.4)]"
                href={c.href}
                target="_blank"
                rel="noreferrer"
              >
                <span className="text-indigo flex-none mt-0.5">{c.ic}</span>
                <span className="flex flex-col gap-[5px]">
                  <span className="font-display font-semibold text-base inline-flex items-center gap-1.5 tracking-[-0.02em] leading-[1.05]">
                    {c.t} <IconArrowUpRight size={14} />
                  </span>
                  <span className="text-xs text-ink-3 font-mono">{c.d}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
