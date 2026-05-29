import type { ReactNode } from 'react';

const HL_RE =
  /(\/\/[^\n]*)|("[^"]*"|'[^']*'|`[^`]*`)|\b(import|from|export|default|const|new|await|async|return)\b|\b(buildJsonApi|fetch|basePath|bucket|repo|app|db|endpoint)\b/g;

const CLASS: Record<string, string> = {
  com: 'text-code-dim italic',
  str: 'text-tk-str',
  key: 'text-tk-key',
  fn: 'text-tk-fn',
};

/** Tiny TS-flavoured syntax highlighter for the code panels. */
export function hl(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  HL_RE.lastIndex = 0;
  while ((m = HL_RE.exec(code))) {
    if (m.index > last) out.push(<span key={i++}>{code.slice(last, m.index)}</span>);
    let cls = '';
    if (m[1]) cls = CLASS.com!;
    else if (m[2]) cls = CLASS.str!;
    else if (m[3]) cls = CLASS.key!;
    else if (m[4]) cls = CLASS.fn!;
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    );
    last = HL_RE.lastIndex;
  }
  if (last < code.length) out.push(<span key={i++}>{code.slice(last)}</span>);
  return out;
}
