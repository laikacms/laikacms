import type { ReactNode } from 'react';

import { IconBook, IconCube, IconGlobe, IconPlug, IconScales, IconSpark, IconSwap } from './icons';

interface Pillar {
  icon: ReactNode;
  t: string;
  d: string;
  lead?: boolean;
}

const PILLARS: Pillar[] = [
  {
    icon: <IconScales size={20} />,
    t: 'MIT licensed, end to end',
    d: 'Core, storage adapters, the Decap bridge, the hosted gateway — every line is MIT. No proprietary tier, no upsell, no vendor capture. Read the source before you adopt it.',
    lead: true,
  },
  {
    icon: <IconGlobe size={20} />,
    t: 'Runtime-agnostic',
    d: 'The API hands back a standard fetch handler, so the same code runs on Node, Bun, Deno, Cloudflare Workers, or in the browser.',
  },
  {
    icon: <IconCube size={20} />,
    t: 'API-first',
    d: 'A clean JSON:API over your content. Point Decap CMS at it, or build your own front end on the very same endpoints.',
  },
  {
    icon: <IconSwap size={20} />,
    t: '40+ swappable backends',
    d: 'Back your content with the filesystem, object storage, a Git repo, any SQL database, MongoDB, Notion, Neo4j, IPFS — 40+ stores in all. Change the repository in a single line.',
  },
  {
    icon: <IconBook size={20} />,
    t: 'Pluggable serializers',
    d: 'Store content as JSON, YAML, Markdown with frontmatter, or raw bytes. The on-disk format is a choice, not a constraint.',
  },
  {
    icon: <IconSpark size={20} />,
    t: 'Decap-native',
    d: 'A git-gateway-compatible HTTP handler with OAuth2 + PKCE built in. Point Decap CMS straight at Laika, or self-install the hosted gateway — all MIT.',
  },
  {
    icon: <IconPlug size={20} />,
    t: 'Developed in the open',
    d: 'Built publicly on GitHub with changesets and a public roadmap. Contributions, adapters and issues welcome.',
  },
];

export function Features() {
  return (
    <section className="border-t border-hairline py-28 max-[760px]:py-[76px] relative">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <span className="font-mono text-[12.5px] tracking-[0.12em] uppercase text-indigo font-medium inline-flex items-center gap-[9px] whitespace-nowrap before:content-[''] before:w-[22px] before:h-[1.5px] before:bg-indigo before:inline-block">
          What Laika is
        </span>
        <h2 className="text-[clamp(32px,4.2vw,50px)] mt-5 max-w-[18ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          An open-source content layer you actually own.
        </h2>
        <p className="mt-[22px] text-[clamp(17px,1.5vw,20px)] text-ink-2 max-w-[56ch] leading-[1.55]">
          Laika CMS is modular, runtime-agnostic content management. The defining idea: the storage backend should be a
          swappable detail, not an architecture you marry — so it ships with 40+ of them, and all of it is yours, under
          the MIT license.
        </p>

        <div className="mt-[52px] grid grid-cols-3 max-[920px]:grid-cols-2 max-[620px]:grid-cols-1 gap-[22px]">
          {PILLARS.map(p => {
            const base = 'relative px-[26px] py-[28px] border rounded-[14px] bg-surface border-hairline';
            const lead =
              'relative px-[26px] py-[28px] border rounded-[14px] bg-indigo-tint border-[color-mix(in_oklab,var(--color-indigo),white_60%)]';
            return (
              <div className={p.lead ? lead : base} key={p.t}>
                <span
                  className={'inline-grid place-items-center w-11 h-11 rounded-[11px] text-indigo border border-indigo-tint-2 '
                    + (p.lead ? 'bg-white' : 'bg-surface')}
                >
                  {p.icon}
                </span>
                <h3 className="text-[20px] mt-[18px] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
                  {p.t}
                </h3>
                <p className="mt-2.5 text-ink-2 text-[15px] leading-[1.6]">{p.d}</p>
                {p.lead && (
                  <span className="absolute top-[22px] right-[22px] text-[11px] tracking-[0.08em] text-white bg-indigo px-[9px] py-[3px] rounded-md font-mono">
                    MIT
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
