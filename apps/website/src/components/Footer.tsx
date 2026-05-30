import { DOCS, REPO } from '../data';
import { Logo } from './icons';

const COLS: Array<[string, Array<[string, string]>]> = [
  [
    'Project',
    [
      ['GitHub', REPO],
      ['Roadmap', REPO + '/blob/develop/ROADMAP.md'],
      ['Contributing', REPO + '/blob/develop/CONTRIBUTING.md'],
      ['Releases', REPO + '/releases'],
    ],
  ],
  [
    'Docs',
    [
      ['Getting Started', DOCS + '/getting-started.md'],
      ['Architecture', DOCS + '/architecture.md'],
      ['API Reference', DOCS + '/api-reference.md'],
      ['Packages', DOCS + '/packages.md'],
    ],
  ],
  ['For machines', [['AGENTS.md', REPO + '/blob/develop/AGENTS.md']]],
  [
    'Trust',
    [
      ['MIT License', REPO + '/blob/develop/LICENSE'],
      ['Security policy', REPO + '/blob/develop/SECURITY.md'],
    ],
  ],
];

export function Footer() {
  return (
    <footer className="border-t border-hairline bg-surface py-[60px] pb-11">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px] grid grid-cols-[1.3fr_2fr] max-[760px]:grid-cols-1 gap-[56px] max-[760px]:gap-10">
        <div>
          <Logo height={28} />
          <p className="mt-[18px] text-ink-2 text-[14.5px] max-w-[36ch] leading-[1.6]">
            Modular, runtime-agnostic, open-source content management. The basis for modern content management.
          </p>
          <span className="block mt-5 text-xs text-ink-3 font-mono">
            MIT · © 2026 Laika CMS contributors
          </span>
        </div>
        <div className="grid grid-cols-4 max-[760px]:grid-cols-2 gap-7">
          {COLS.map(([h, links]) => (
            <div className="flex flex-col gap-3" key={h}>
              <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3 mb-0.5 font-mono">
                {h}
              </span>
              {links.map(([t, href]) => (
                <a
                  key={t}
                  className="text-sm text-ink-2 transition-colors duration-150 hover:text-indigo"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
