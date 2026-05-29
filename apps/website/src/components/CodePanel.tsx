import { useEffect, useState } from 'react';

import { LAIKA_SWAP } from '../data';
import { hl } from '../highlight';
import { useCopy } from '../hooks';
import { IconCheck, IconCopy, IconSwap } from './icons';

const CHIP_BASE =
  'font-mono text-xs text-code-dim bg-transparent border border-code-line rounded-[7px] py-[5px] px-[11px] cursor-pointer transition-[color,border-color,background] duration-150 hover:text-code-ink hover:border-[#4a4f74]';
const CHIP_ACTIVE =
  ' text-white bg-indigo border-[color-mix(in_oklab,var(--color-indigo),white_18%)] hover:text-white hover:border-[color-mix(in_oklab,var(--color-indigo),white_18%)]';

const COPY_BTN =
  'inline-flex items-center gap-1.5 bg-transparent border border-code-line text-code-dim py-[5px] px-2.5 rounded-[7px] text-xs cursor-pointer transition-[color,border-color] duration-150 hover:text-code-ink hover:border-[#4a4f74]';

const LINE = 'flex gap-4 whitespace-pre rounded-[5px] px-1.5 -mx-1.5';

export function CodePanel() {
  const [active, setActive] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [copied, copy] = useCopy();
  const b = LAIKA_SWAP[active]!;

  useEffect(() => {
    setPulse((p) => p + 1);
  }, [active]);

  const code = `import { buildJsonApi } from "laikacms/storage-api";
import { ${b.cls} } from "${b.path}";

const repo = ${b.ctor};
const api = buildJsonApi({ repo });

// a JSON:API for your content — runs anywhere fetch runs
export default { fetch: api.fetch };`;

  const lines = code.split('\n');

  return (
    <div className="relative z-[1] bg-code-bg rounded-[14px] border border-[#2c2f44] shadow-[0_2px_4px_rgba(20,23,40,0.2),0_30px_60px_-28px_rgba(31,38,95,0.5)] overflow-hidden text-[13.5px]">
      {/* title bar */}
      <div className="flex items-center gap-3 px-3.5 py-3 border-b border-code-line bg-[color-mix(in_oklab,var(--color-code-bg),white_3%)]">
        <span className="inline-flex gap-[7px]">
          <i className="w-[11px] h-[11px] rounded-full block bg-[#e06c63]" />
          <i className="w-[11px] h-[11px] rounded-full block bg-[#e0b15a]" />
          <i className="w-[11px] h-[11px] rounded-full block bg-[#5cb877]" />
        </span>
        <span className="text-code-dim text-[12.5px] font-mono">worker.ts</span>
        <button className={`${COPY_BTN} font-mono ml-auto`} onClick={() => copy(code)}>
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      {/* repo swap row */}
      <div className="flex items-center gap-3.5 px-3.5 py-3 border-b border-code-line bg-[color-mix(in_oklab,var(--color-code-bg),black_12%)]">
        <span className="text-code-dim text-[11.5px] inline-flex items-center gap-1.5 uppercase tracking-[0.08em] flex-none font-mono">
          <IconSwap size={15} /> repository
        </span>
        <div className="flex gap-[7px] flex-wrap">
          {LAIKA_SWAP.map((s, i) => (
            <button
              key={s.id}
              className={CHIP_BASE + (i === active ? CHIP_ACTIVE : '')}
              onClick={() => setActive(i)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* code body */}
      <pre className="m-0 px-4 pt-[18px] pb-5 overflow-x-auto leading-[1.62] font-mono" key={pulse}>
        {lines.map((ln, i) => {
          const swapped = i === 1 || i === 3;
          return (
            <div
              key={i}
              className={
                LINE +
                (swapped
                  ? ' bg-[color-mix(in_oklab,var(--color-indigo),transparent_84%)] animate-swapflash'
                  : '')
              }
            >
              <span className="text-[#474c70] select-none text-right w-[18px] flex-none">
                {i + 1}
              </span>
              <span className="text-code-ink">{ln ? hl(ln) : ' '}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/** Static (non-interactive) highlighted code block. */
export function CodeBlock({ code, file }: { code: string; file: string }) {
  const [copied, copy] = useCopy();
  const lines = code.split('\n');
  return (
    <div className="bg-code-bg rounded-[14px] border border-[#2c2f44] shadow-[0_2px_4px_rgba(20,23,40,0.2),0_30px_60px_-28px_rgba(31,38,95,0.5)] overflow-hidden text-[13.5px]">
      <div className="flex items-center gap-3 px-3.5 py-3 border-b border-code-line bg-[color-mix(in_oklab,var(--color-code-bg),white_3%)]">
        <span className="inline-flex gap-[7px]">
          <i className="w-[11px] h-[11px] rounded-full block bg-[#e06c63]" />
          <i className="w-[11px] h-[11px] rounded-full block bg-[#e0b15a]" />
          <i className="w-[11px] h-[11px] rounded-full block bg-[#5cb877]" />
        </span>
        <span className="text-code-dim text-[12.5px] font-mono">{file}</span>
        <button className={`${COPY_BTN} font-mono ml-auto`} onClick={() => copy(code)}>
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="m-0 px-4 pt-[18px] pb-5 overflow-x-auto leading-[1.62] font-mono">
        {lines.map((ln, i) => (
          <div key={i} className={LINE}>
            <span className="text-[#474c70] select-none text-right w-[18px] flex-none">{i + 1}</span>
            <span className="text-code-ink">{ln ? hl(ln) : ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
