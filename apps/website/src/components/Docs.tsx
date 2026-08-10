import type { ReactNode } from 'react';

import { IconArrowUpRight } from './icons';

const EYEBROW = 'Getting started';
const HEADING = 'Install the package, hand back a fetch.';
const LEAD =
  'One package, subpath exports for everything else. Install it, pick a storage repository, and you have a content API you can deploy anywhere.';

/* Exported for the mounting page's interactive slots (see the usage below). */
export const INSTALL_COMMAND = 'pnpm add laikacms';
export const STARTER_FILE = 'worker.ts';
export const STARTER_CODE = `import { buildJsonApi } from "laikacms/storage-api";
import { allowAll } from "laikacms/json-api";
import { FileSystemStorageRepository } from "laikacms/storage-fs";

const repo = new FileSystemStorageRepository({ basePath: "./content" });
const api = buildJsonApi({ repo, authorize: allowAll });

export default { fetch: api.fetch };`;

const LINKS = [
  { title: 'Getting Started', blurb: 'Five minutes to your first content API', href: '/docs/getting-started' },
  { title: 'Architecture', blurb: 'How core, adapters and the gateway fit', href: '/docs/architecture' },
  { title: 'API Reference', blurb: 'Every method on the JSON:API surface', href: '/docs/api-reference' },
  { title: 'Decap Integration', blurb: 'Wire up the git-gateway + editor UI', href: '/docs/decap-integration' },
  { title: 'Deployment', blurb: 'Node, Bun, Deno, Workers, the edge', href: '/docs/deployment' },
  { title: 'Packages', blurb: 'The full map of subpath exports', href: '/docs/packages' },
];

/* Not mounted on any page today — the getting-started content is served by the
   docs site under /docs/.

   The two interactive bits are named slots because a client directive only
   works in an `.astro`/`.mdx` file. A page mounting this section writes:

     <Docs>
       <CopyButton client:visible text={INSTALL_COMMAND} slot="copy" />
       <CodeBlock client:visible code={STARTER_CODE} file={STARTER_FILE} slot="starter" />
     </Docs> */
interface DocsProps {
  /** `<CopyButton client:visible text={INSTALL_COMMAND} />` */
  copy?: ReactNode;
  /** `<CodeBlock client:visible code={STARTER_CODE} file={STARTER_FILE} />` */
  starter?: ReactNode;
}

export function Docs({ copy, starter }: DocsProps) {
  return (
    <section className="py-28 max-[760px]:py-[76px] relative">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <span className="font-mono text-[12.5px] tracking-[0.12em] uppercase text-indigo font-medium inline-flex items-center gap-[9px] whitespace-nowrap before:content-[''] before:w-[22px] before:h-[1.5px] before:bg-indigo before:inline-block">
          {EYEBROW}
        </span>
        <h2 className="text-[clamp(32px,4.2vw,50px)] mt-5 max-w-[18ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          {HEADING}
        </h2>
        <p className="mt-[22px] text-[clamp(17px,1.5vw,20px)] text-ink-2 max-w-[56ch] leading-[1.55]">
          {LEAD}
        </p>

        <div className="mt-11 grid grid-cols-[1.15fr_0.85fr] max-[880px]:grid-cols-1 gap-10 max-[880px]:gap-[30px] items-start">
          <div>
            <div className="flex items-center gap-3 bg-code-bg rounded-[11px] px-[18px] py-4">
              <span className="text-code-dim font-mono">$</span>
              <code className="text-code-ink text-[14.5px] flex-1 overflow-x-auto whitespace-nowrap font-mono">
                {INSTALL_COMMAND}
              </code>
              {copy}
            </div>
            <div className="mt-4">{starter}</div>
          </div>

          <div className="flex flex-col border border-hairline rounded-[14px] overflow-hidden bg-surface">
            {LINKS.map((link, i, all) => (
              <a
                key={link.href}
                className={'flex flex-col gap-[3px] px-[22px] py-[18px] relative transition-[background] duration-150 hover:bg-surface-2 group '
                  + (i < all.length - 1 ? 'border-b border-hairline' : '')}
                href={link.href}
              >
                <span className="font-display font-semibold text-[16px] tracking-[-0.02em] leading-[1.05]">
                  {link.title}
                </span>
                <span className="text-[13px] text-ink-2">{link.blurb}</span>
                <span className="absolute right-[22px] top-1/2 -translate-y-1/2 text-ink-3 transition-[color,transform] duration-150 group-hover:text-indigo group-hover:translate-x-[2px] group-hover:-translate-y-1/2">
                  <IconArrowUpRight size={16} />
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
