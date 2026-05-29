import { DOCS, REPO } from '../data';
import { IconArrow, IconGitHub } from './icons';

const BTN_PRIMARY =
  'font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer border border-transparent whitespace-nowrap bg-indigo text-white shadow-[0_1px_2px_rgba(31,38,95,0.18),0_8px_22px_-12px_rgba(63,81,181,0.55)] transition-[background,color,border-color,transform,box-shadow] duration-150 hover:bg-indigo-700 active:translate-y-px';

const BTN_GHOST =
  'font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer whitespace-nowrap bg-surface text-ink border border-hairline-2 transition-[background,color,border-color,transform,box-shadow] duration-150 hover:border-ink-3 hover:bg-surface-2 active:translate-y-px';

export function Platform() {
  return (
    <section className="py-28 max-[760px]:py-[76px] relative min-h-[70vh] grid place-items-center text-center">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <div className="max-w-[760px] mx-auto flex flex-col items-center">
          <span className="font-mono text-xs tracking-[0.1em] uppercase text-indigo bg-indigo-tint border border-indigo-tint-2 px-3.5 py-[7px] rounded-full">
            Coming soon
          </span>
          <h2 className="mt-6 text-[clamp(34px,5vw,56px)] tracking-[-0.03em] font-display font-semibold leading-[1.05]">
            A hosted gateway,
            <br />
            without standing up your own.
          </h2>
          <p className="mt-[22px] text-[clamp(16px,1.5vw,19px)] text-ink-2 leading-[1.6] max-w-[60ch]">
            Today you can self-install <span className="font-mono">laika-gateway</span> — a
            multi-tenant Cloudflare Worker that points Decap CMS at your own repository. The managed
            Platform will take that further: one place to provision gateways, manage tenants, and
            connect backends. Same open core underneath, nothing locked away.
          </p>
          <div className="mt-[34px] flex gap-3.5 flex-wrap justify-center">
            <a className={BTN_PRIMARY} href={REPO} target="_blank" rel="noreferrer">
              <IconGitHub size={17} /> Watch the repo
            </a>
            <a
              className={BTN_GHOST}
              href={DOCS + '/deployment.md'}
              target="_blank"
              rel="noreferrer"
            >
              Self-host today <IconArrow size={16} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
