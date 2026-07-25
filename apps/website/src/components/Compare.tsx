/* "Where Laika sits" — an honest map of the headless CMS field.
   Tone rule: describe competitors neutrally (they're good tools), then state
   the concrete difference. No checkmark tables, no strawmen. */

interface Rival {
  name: string;
  what: string;
  laika: string;
}

const RIVALS: Rival[] = [
  {
    name: 'Contentful',
    what:
      'The enterprise SaaS standard. Polished and proven. And fully proprietary, metered per seat, with your content living in their cloud.',
    laika: 'The same API-first workflow, MIT end to end, with content in a store you own.',
  },
  {
    name: 'Sanity',
    what:
      'An open-source Studio in front of the proprietary hosted Content Lake: the editor is yours, the data layer is theirs.',
    laika: 'Open all the way down: the API layer is MIT too, and it fronts your database, bucket or repo.',
  },
  {
    name: 'Strapi',
    what: 'Self-hosted open core on Node and SQL, with an Enterprise Edition and a cloud for the advanced features.',
    laika: 'One MIT tier, no enterprise edition, and it runs beyond Node: Bun, Deno, workers, the browser.',
  },
  {
    name: 'Payload',
    what: 'MIT, code-first and Next.js-native, backed by Postgres or MongoDB. Now part of Figma.',
    laika: 'Framework-free and independent, with 40+ interchangeable backends instead of two.',
  },
  {
    name: 'Tina',
    what: 'The successor to Forestry: visual editing over Markdown, with the commercial TinaCloud at the centre.',
    laika: 'Git is one backend here, not the business model. The whole stack self-hosts.',
  },
  {
    name: 'EmDash',
    what: 'An open-source, Astro-native CMS built for humans and agents.',
    laika: 'Framework-agnostic by design: bring Astro, or anything else that speaks fetch.',
  },
];

export function Compare() {
  return (
    <section className="border-t border-hairline py-28 max-[760px]:py-[76px]">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <span className="font-mono text-[12.5px] tracking-[0.12em] uppercase text-indigo font-medium inline-flex items-center gap-[9px] whitespace-nowrap before:content-[''] before:w-[22px] before:h-[1.5px] before:bg-indigo before:inline-block">
          The field
        </span>
        <h2 className="text-[clamp(32px,4.2vw,50px)] mt-5 max-w-[20ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          Where Laika sits.
        </h2>
        <p className="mt-[22px] text-[clamp(17px,1.5vw,20px)] text-ink-2 max-w-[56ch] leading-[1.55]">
          The headless CMS field is full of good tools: here is the honest map. What sets Laika apart is never a
          gimmick: it is who owns the code, who owns the content, and who decides what you pay for.
        </p>

        <div className="mt-[52px] border border-hairline rounded-[14px] bg-surface overflow-hidden">
          <div className="grid grid-cols-[150px_1.15fr_1fr] max-[880px]:hidden gap-x-8 px-[26px] py-3.5 border-b border-hairline bg-surface-2 font-mono text-[11.5px] tracking-[0.1em] uppercase text-ink-3">
            <span />
            <span>What it is</span>
            <span>The Laika difference</span>
          </div>
          {RIVALS.map((r, i) => (
            <div
              key={r.name}
              className={'grid grid-cols-[150px_1.15fr_1fr] max-[880px]:grid-cols-1 gap-x-8 gap-y-2 px-[26px] py-[22px]'
                + (i > 0 ? ' border-t border-hairline' : '')}
            >
              <span className="font-display font-semibold text-[17px] tracking-[-0.01em]">{r.name}</span>
              <p className="text-ink-2 text-[15px] leading-[1.6]">{r.what}</p>
              <p className="text-[15px] leading-[1.6] text-indigo-ink">
                <span className="max-[880px]:inline hidden font-mono text-[11px] tracking-[0.08em] uppercase text-indigo mr-2">
                  Laika
                </span>
                {r.laika}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
