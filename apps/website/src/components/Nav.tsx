import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { REPO } from '../data';
import { IconGitHub, Logo } from './icons';

type TabId = '/' | '/docs' | '/community' | '/platform';

const TABS: Array<{ id: TabId; label: string; soon?: boolean }> = [
  { id: '/', label: 'Features' },
  { id: '/docs', label: 'Docs' },
  { id: '/community', label: 'Community' },
  { id: '/platform', label: 'Platform', soon: true },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={
        'sticky top-0 z-50 transition-[background,border-color,backdrop-filter] duration-[250ms] border-b ' +
        (scrolled
          ? 'bg-[color-mix(in_oklab,var(--color-bg),transparent_18%)] backdrop-saturate-[1.4] backdrop-blur-[14px] border-hairline'
          : 'border-transparent')
      }
    >
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px] h-[70px] flex items-center justify-between">
        <Link
          to="/"
          aria-label="Laika CMS"
          className="bg-none border-0 p-0 cursor-pointer inline-flex"
        >
          <Logo height={30} />
        </Link>

        <nav className="flex gap-1.5 max-[920px]:hidden" role="tablist">
          {TABS.map(({ id, label, soon }) => {
            const active = path === id;
            return (
              <Link
                key={id}
                to={id}
                role="tab"
                className={
                  'font-body text-[15px] font-[450] cursor-pointer px-3.5 py-2 rounded-[9px] inline-flex items-center gap-[7px] whitespace-nowrap transition-[color,background] duration-150 ' +
                  (active
                    ? 'text-indigo bg-indigo-tint'
                    : 'text-ink-2 hover:text-ink hover:bg-surface-2')
                }
              >
                {label}
                {soon && (
                  <span className="font-mono text-[9.5px] tracking-[0.06em] uppercase text-ink-3 border border-hairline-2 rounded-[5px] px-[5px] py-px leading-[1.4]">
                    soon
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3.5">
          <a
            className="inline-flex items-center gap-2 text-[13px] text-ink-2 whitespace-nowrap px-3 py-2 rounded-[9px] border border-hairline-2 bg-surface transition-[border-color,color] duration-150 hover:border-ink-3 hover:text-ink"
            href={REPO}
            target="_blank"
            rel="noreferrer"
          >
            <IconGitHub size={16} /> <span className="max-[560px]:hidden">GitHub</span>
          </a>
          <button
            type="button"
            onClick={() => navigate({ to: '/docs' })}
            className="font-body font-medium text-[15.5px] rounded-[10px] py-[13px] px-[22px] inline-flex items-center gap-[9px] cursor-pointer border border-transparent whitespace-nowrap bg-indigo text-white shadow-[0_1px_2px_rgba(31,38,95,0.18),0_8px_22px_-12px_rgba(63,81,181,0.55)] transition-[background,color,border-color,transform,box-shadow] duration-150 hover:bg-indigo-700 active:translate-y-px"
          >
            Get started
          </button>
        </div>
      </div>
    </header>
  );
}
