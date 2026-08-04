import { useCopy } from '../hooks';
import { IconCheck, IconCopy } from './icons';

/** Copy-to-clipboard button — the one interactive bit of a static code block. */
export function CopyButton({ text, label }: { text: string, label?: string }) {
  const [copied, copy] = useCopy();
  return (
    <button
      className="inline-flex items-center gap-1.5 bg-transparent border border-code-line text-code-dim py-[5px] px-2.5 rounded-[7px] text-xs cursor-pointer transition-[color,border-color] duration-150 hover:text-code-ink hover:border-[#4a4f74] font-mono"
      onClick={() => copy(text)}
      aria-label="copy"
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      {label !== undefined && (copied ? 'copied' : label)}
    </button>
  );
}
