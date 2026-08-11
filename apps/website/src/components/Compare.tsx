/* "Where Laika sits" — an honest map of the headless CMS field.
   Tone rule: describe competitors neutrally (they're good tools), then state
   the concrete difference. No checkmark tables, no strawmen.
   The map itself is content, passed in as props from the page that uses it. */

export interface Rival {
  name: string;
  what: string;
  laika: string;
}

export interface CompareProps {
  eyebrow: string;
  heading: string;
  lead: string;
  columns: string[];
  rivals: Rival[];
}

const ROW = 'grid grid-cols-[150px_1.15fr_1fr] max-[880px]:grid-cols-1 gap-x-8 gap-y-2 px-[26px] py-[22px]';

export function Compare({ eyebrow, heading, lead, columns, rivals }: CompareProps) {
  return (
    <section className="border-t border-hairline py-28 max-[760px]:py-[76px]">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <span className="font-mono text-[12.5px] tracking-[0.12em] uppercase text-accent font-medium inline-flex items-center gap-[9px] whitespace-nowrap before:content-[''] before:w-[22px] before:h-[1.5px] before:bg-accent before:inline-block">
          {eyebrow}
        </span>
        <h2 className="text-[clamp(32px,4.2vw,50px)] mt-5 max-w-[20ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          {heading}
        </h2>
        <p className="mt-[22px] text-[clamp(17px,1.5vw,20px)] text-ink-2 max-w-[56ch] leading-[1.55]">
          {lead}
        </p>

        <div className="mt-[52px] border border-hairline rounded-[14px] bg-surface overflow-hidden">
          <div className="grid grid-cols-[150px_1.15fr_1fr] max-[880px]:hidden gap-x-8 px-[26px] py-3.5 border-b border-hairline bg-surface-2 font-mono text-[11.5px] tracking-[0.1em] uppercase text-ink-3">
            <span />
            {columns.map(c => <span key={c}>{c}</span>)}
          </div>
          {rivals.map((r, i) => (
            <div key={r.name} className={ROW + (i > 0 ? ' border-t border-hairline' : '')}>
              <span className="font-display font-semibold text-[17px] tracking-[-0.01em]">
                {r.name}
              </span>
              <p className="text-ink-2 text-[15px] leading-[1.6]">{r.what}</p>
              <p className="text-[15px] leading-[1.6] text-indigo-ink">
                <span className="max-[880px]:inline hidden font-mono text-[11px] tracking-[0.08em] uppercase text-accent mr-2">
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
