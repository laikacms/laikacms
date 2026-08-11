import { Logo } from './icons';

interface FooterLink {
  label: string;
  href: string;
}

interface FooterColumn {
  heading: string;
  links: FooterLink[];
}

interface FooterProps {
  tagline: string;
  legal: string;
  columns: FooterColumn[];
}

export function Footer({ tagline, legal, columns }: FooterProps) {
  return (
    <footer className="border-t border-hairline bg-surface py-[60px] pb-11">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px] grid grid-cols-[1.3fr_2fr] max-[760px]:grid-cols-1 gap-[56px] max-[760px]:gap-10">
        <div>
          <Logo height={28} />
          <p className="mt-[18px] text-ink-2 text-[14.5px] max-w-[36ch] leading-[1.6]">{tagline}</p>
          <span className="block mt-5 text-xs text-ink-3 font-mono">{legal}</span>
        </div>
        <div className="grid grid-cols-4 max-[760px]:grid-cols-2 gap-7">
          {columns.map(column => (
            <div key={column.heading} className="flex flex-col gap-3">
              <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3 mb-0.5 font-mono">
                {column.heading}
              </span>
              {column.links.map(link => (
                <a
                  key={link.href}
                  className="text-sm text-ink-2 transition-colors duration-150 hover:text-accent"
                  href={link.href}
                  target={link.href.startsWith('http') ? '_blank' : undefined}
                  rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                >
                  {link.label}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
