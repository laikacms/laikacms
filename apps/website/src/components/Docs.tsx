import { DOCS } from '../data';
import { useCopy } from '../hooks';
import { CodeBlock } from './CodePanel';
import { IconArrowUpRight, IconCheck, IconCopy } from './icons';

const INSTALL_CMD = 'pnpm add laikacms';

const STARTER_CODE = `import { buildJsonApi } from "laikacms/storage-api";
import { FileSystemStorageRepository } from "laikacms/storage-fs";

const repo = new FileSystemStorageRepository({ basePath: "./content" });
const api = buildJsonApi({ repo });

export default { fetch: api.fetch };`;

const DOC_LINKS: Array<[string, string, string]> = [
  ['Getting Started', 'Five minutes to your first content API', '/getting-started.md'],
  ['Architecture', 'How core, adapters and the gateway fit', '/architecture.md'],
  ['API Reference', 'Every method on the JSON:API surface', '/api-reference.md'],
  ['Decap Integration', 'Wire up the git-gateway + editor UI', '/decap-integration.md'],
  ['Deployment', 'Node, Bun, Deno, Workers, the edge', '/deployment.md'],
  ['Packages', 'The full map of subpath exports', '/packages.md'],
];

export function Docs() {
  const [copied, copy] = useCopy();
  return (
    <section className="py-28 max-[760px]:py-[76px] relative">
      <div className="max-w-[1200px] mx-auto px-10 max-[760px]:px-[22px]">
        <span className="font-mono text-[12.5px] tracking-[0.12em] uppercase text-indigo font-medium inline-flex items-center gap-[9px] whitespace-nowrap before:content-[''] before:w-[22px] before:h-[1.5px] before:bg-indigo before:inline-block">
          Getting started
        </span>
        <h2 className="text-[clamp(32px,4.2vw,50px)] mt-5 max-w-[18ch] font-display font-semibold tracking-[-0.02em] leading-[1.05]">
          Install the package, hand back a fetch.
        </h2>
        <p className="mt-[22px] text-[clamp(17px,1.5vw,20px)] text-ink-2 max-w-[56ch] leading-[1.55]">
          One package, subpath exports for everything else. Install it, pick a storage repository, and you have a
          content API you can deploy anywhere.
        </p>

        <div className="mt-11 grid grid-cols-[1.15fr_0.85fr] max-[880px]:grid-cols-1 gap-10 max-[880px]:gap-[30px] items-start">
          <div>
            <div className="flex items-center gap-3 bg-code-bg rounded-[11px] px-[18px] py-4">
              <span className="text-code-dim font-mono">$</span>
              <code className="text-code-ink text-[14.5px] flex-1 overflow-x-auto whitespace-nowrap font-mono">
                {INSTALL_CMD}
              </code>
              <button
                className="bg-transparent border border-code-line text-code-dim rounded-lg p-[7px] cursor-pointer grid place-items-center transition-[color,border-color] duration-150 hover:text-code-ink hover:border-[#4a4f74]"
                onClick={() => copy(INSTALL_CMD)}
                aria-label="copy"
              >
                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              </button>
            </div>
            <div className="mt-4">
              <CodeBlock code={STARTER_CODE} file="worker.ts" />
            </div>
          </div>

          <div className="flex flex-col border border-hairline rounded-[14px] overflow-hidden bg-surface">
            {DOC_LINKS.map(([t, d, href], i, all) => (
              <a
                key={t}
                className={'flex flex-col gap-[3px] px-[22px] py-[18px] relative transition-[background] duration-150 hover:bg-surface-2 group '
                  + (i < all.length - 1 ? 'border-b border-hairline' : '')}
                href={DOCS + href}
                target="_blank"
                rel="noreferrer"
              >
                <span className="font-display font-semibold text-[16px] tracking-[-0.02em] leading-[1.05]">
                  {t}
                </span>
                <span className="text-[13px] text-ink-2">{d}</span>
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
