import { IconGitHub, Logo } from './icons';

/* A tab with `to` is a page on this site; a tab with `href` leaves it (the docs
   are a separate static site under /docs/). The hosted platform is hidden for
   now; self-hosting is the default. The tabs and CTA come from the layout.

   The scrolled state is a class on `#site-nav` rather than React state — the
   scroll listener in Base.astro toggles `#site-nav.is-scrolled` (styles.css) —
   so the header needs no hydration.

   `path` also comes from the layout: a React component has no `Astro.url`. */

const TAB =
  'font-body text-[15px] font-[450] cursor-pointer px-3.5 py-2 rounded-[9px] inline-flex items-center gap-[7px] whitespace-nowrap transition-[color,background] duration-150 ';
const TAB_ACTIVE = 'text-indigo bg-indigo-tint';
const TAB_IDLE = 'text-ink-2 hover:text-ink hover:bg-surface-2';

interface NavTab {
  label: string;
  /** An in-site page path (marks the active tab); mutually exclusive with `href`. */
  to?: string;
  /** An external / off-site link. */
  href?: string;
}

interface NavProps {
  path: string;
  tabs: NavTab[];
  githubLabel: string;
  githubHref: string;
  cta: { label: string, href: string };
}

export function Nav({ path, tabs, githubLabel, githubHref, cta }: NavProps) {
  return (
    <header
      id="site-nav"
      className="sticky top-0 z-50 transition-[background,border-color,backdrop-filter] duration-[250ms] border-b border-transparent"
    >
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px] h-[70px] flex items-center justify-between">
        <a href="/" aria-label="Laika CMS" className="bg-none border-0 p-0 cursor-pointer inline-flex">
          <Logo height={30} />
        </a>

        <nav className="flex gap-1.5 max-[920px]:hidden" role="tablist">
          {tabs.map(tab => (
            <a
              key={tab.label}
              href={tab.to ?? tab.href}
              role="tab"
              className={TAB + (tab.to !== undefined && path === tab.to ? TAB_ACTIVE : TAB_IDLE)}
            >
              {tab.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3.5">
          <a
            className="inline-flex items-center gap-2 text-[13px] text-ink-2 whitespace-nowrap px-3 py-2 rounded-[9px] border border-hairline-2 bg-surface transition-[border-color,color] duration-150 hover:border-ink-3 hover:text-ink"
            href={githubHref}
            target="_blank"
            rel="noreferrer"
          >
            <IconGitHub size={16} /> <span className="max-[560px]:hidden">{githubLabel}</span>
          </a>
          <a
            href={cta.href}
            className="font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer border border-transparent whitespace-nowrap bg-indigo text-white shadow-[0_1px_2px_rgba(31,38,95,0.18),0_8px_22px_-12px_rgba(63,81,181,0.55)] transition-[background,color,border-color,transform,box-shadow] duration-150 hover:bg-indigo-700 active:translate-y-px"
          >
            {cta.label}
          </a>
        </div>
      </div>
    </header>
  );
}
