import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * LaTeX <-> Portable Text (a deliberately focused subset).
 *
 * Round-trips cleanly for documents written in the dialect this package emits:
 *  - Headings:    `\section{…}` → h1, `\subsection` → h2, `\subsubsection` → h3,
 *                 `\paragraph` → h4, `\subparagraph` → h5
 *  - Bold:        `\textbf{bold}`
 *  - Italic:      `\textit{italic}`  (also reads `\emph{…}`)
 *  - Underline:   `\underline{…}`
 *  - Strike:      `\sout{…}`
 *  - Code:        `\texttt{inline}`
 *  - Link:        `\href{url}{label}`
 *  - Bullet list: `\begin{itemize}\item …\end{itemize}`
 *  - Numbered:    `\begin{enumerate}\item …\end{enumerate}`
 *  - Block quote: `\begin{quote}…\end{quote}`
 *  - Code block:  `\begin{verbatim}…\end{verbatim}`
 *
 * Full LaTeX is a Turing-complete macro language; this parser handles the
 * subset listed above and treats anything else as literal text.
 */

interface Keys {
  block: () => string;
  span: () => string;
  mark: () => string;
}

function newKeys(): Keys {
  return {
    block: createKeyGenerator('b'),
    span: createKeyGenerator('s'),
    mark: createKeyGenerator('m'),
  };
}

const HEADING_COMMAND: Record<string, string> = {
  h1: 'section',
  h2: 'subsection',
  h3: 'subsubsection',
  h4: 'paragraph',
  h5: 'subparagraph',
};

const HEADING_FROM_COMMAND: Record<string, string> = {
  section: 'h1',
  subsection: 'h2',
  subsubsection: 'h3',
  paragraph: 'h4',
  subparagraph: 'h5',
};

// --- PT -> LaTeX -----------------------------------------------------------

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function spanToLatex(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = escapeLatex(span.text ?? '');
  const marks = span.marks ?? [];
  const decorators = new Set(marks.filter(m => !markDefs.find(d => d._key === m)));
  if (decorators.has('code')) text = `\\texttt{${text}}`;
  if (decorators.has('strike-through')) text = `\\sout{${text}}`;
  if (decorators.has('underline')) text = `\\underline{${text}}`;
  if (decorators.has('em')) text = `\\textit{${text}}`;
  if (decorators.has('strong')) text = `\\textbf{${text}}`;
  const linkKey = marks.find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      text = `\\href{${String(def.href ?? '')}}{${text}}`;
    }
  }
  return text;
}

function spansToLatex(block: PortableTextBlock): string {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToLatex(span, markDefs))
    .join('');
}

function isListBlock(value: unknown): value is PortableTextBlock {
  return (
    !!value
    && typeof value === 'object'
    && (value as { _type?: string })._type === 'block'
    && typeof (value as { listItem?: unknown }).listItem === 'string'
  );
}

function blockToLatex(block: PortableTextBlock | Record<string, unknown>): string {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const inner = spansToLatex(tb);
    const cmd = HEADING_COMMAND[style];
    if (cmd) return `\\${cmd}{${inner}}`;
    if (style === 'h6') return `\\textbf{${inner}}`; // no native deeper heading
    if (style === 'blockquote') return `\\begin{quote}\n${inner}\n\\end{quote}`;
    return inner;
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    return `\\begin{verbatim}\n${code}\n\\end{verbatim}`;
  }
  return '';
}

export function portableTextToLatex(doc: PortableTextDocument): string {
  const parts: string[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const first = block;
      const env = first.listItem === 'number' ? 'enumerate' : 'itemize';
      const items: string[] = [];
      while (
        i < doc.length
        && isListBlock(doc[i])
        && ((doc[i] as PortableTextBlock).listItem === first.listItem)
      ) {
        items.push(`\\item ${spansToLatex(doc[i] as PortableTextBlock)}`);
        i += 1;
      }
      parts.push(`\\begin{${env}}\n${items.join('\n')}\n\\end{${env}}`);
      continue;
    }
    const out = blockToLatex(block);
    if (out !== '') parts.push(out);
    i += 1;
  }
  return parts.join('\n\n');
}

// --- LaTeX -> PT -----------------------------------------------------------

function unescapeLatex(text: string): string {
  return text
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\([&%$#_{}])/g, '$1');
}

/** Find the matching `}` for the `{` at `input[start]`. Returns its index. */
function matchBrace(input: string, start: number): number {
  let depth = 0;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface ParsedCommand {
  name: string;
  args: string[];
  end: number;
}

/** Parse `\name{a}{b}...` starting at `index` (which points at the backslash). */
function parseCommand(input: string, index: number): ParsedCommand | null {
  const m = /^\\([a-zA-Z]+)/.exec(input.slice(index));
  if (!m) return null;
  let cursor = index + m[0].length;
  const args: string[] = [];
  while (input[cursor] === '{') {
    const close = matchBrace(input, cursor);
    if (close === -1) break;
    args.push(input.slice(cursor + 1, close));
    cursor = close + 1;
  }
  return { name: m[1]!, args, end: cursor };
}

function inlineToSpans(
  text: string,
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
  marks: string[] = [],
): PortableTextSpan[] {
  const spans: PortableTextSpan[] = [];
  let current: { text: string, marks: string[], key: string } | null = null;
  const flush = (): void => {
    if (!current) return;
    spans.push({ _type: 'span', _key: keys.span(), text: current.text, marks: current.marks });
    current = null;
  };
  const emit = (chunk: string, ms: string[]): void => {
    const key = ms.join(' ');
    if (current && current.key === key) current.text += chunk;
    else {
      flush();
      current = { text: chunk, marks: [...ms], key };
    }
  };

  const INLINE_DECORATOR: Record<string, string> = {
    textbf: 'strong',
    textit: 'em',
    emph: 'em',
    underline: 'underline',
    sout: 'strike-through',
    texttt: 'code',
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\') {
      const cmd = parseCommand(text, i);
      if (cmd && cmd.args.length > 0) {
        if (cmd.name === 'href' && cmd.args.length >= 2) {
          const key = keys.mark();
          markDefs.push({ _type: 'link', _key: key, href: cmd.args[0]! });
          // Recurse into the label so e.g. `\href{u}{\textbf{x}}` works.
          const inner = inlineToSpans(cmd.args[1]!, markDefs, keys, [...marks, key]);
          for (const span of inner) {
            const ms = span.marks ?? [];
            emit(span.text, ms);
          }
          i = cmd.end;
          continue;
        }
        const decorator = INLINE_DECORATOR[cmd.name];
        if (decorator) {
          const inner = inlineToSpans(cmd.args[0]!, markDefs, keys, [...marks, decorator]);
          for (const span of inner) {
            const ms = span.marks ?? [];
            emit(span.text, ms);
          }
          i = cmd.end;
          continue;
        }
        if (cmd.name === 'url' && cmd.args.length >= 1) {
          const key = keys.mark();
          markDefs.push({ _type: 'link', _key: key, href: cmd.args[0]! });
          emit(cmd.args[0]!, [...marks, key]);
          i = cmd.end;
          continue;
        }
        // Unknown command with args — drop the command and keep the first arg.
        if (cmd.args.length > 0) {
          emit(cmd.args[0]!, marks);
          i = cmd.end;
          continue;
        }
      }
    }
    // Default: consume up to the next backslash or end.
    const next = text.indexOf('\\', i + 1);
    const chunk = text.slice(i, next === -1 ? text.length : next);
    if (chunk) emit(unescapeLatex(chunk), marks);
    i = next === -1 ? text.length : next;
  }
  flush();
  return spans;
}

function makeTextBlock(
  text: string,
  style: string,
  keys: Keys,
  listItem?: 'bullet' | 'number',
): PortableTextBlock {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = inlineToSpans(text, markDefs, keys);
  const block: PortableTextBlock = { _type: 'block', _key: keys.block(), style, markDefs, children };
  if (listItem) {
    block.listItem = listItem;
    block.level = 1;
  }
  return block;
}

/** Walk top-level commands and environments; build PT blocks. */
function parseDocument(input: string, out: PortableTextDocument, keys: Keys): void {
  let i = 0;
  while (i < input.length) {
    // Skip leading whitespace.
    while (i < input.length && /\s/.test(input[i]!)) i += 1;
    if (i >= input.length) break;

    if (input.startsWith('\\begin{', i)) {
      const open = parseCommand(input, i);
      if (open && open.args.length === 1) {
        const env = open.args[0]!;
        const closeMarker = `\\end{${env}}`;
        const closeIndex = input.indexOf(closeMarker, open.end);
        if (closeIndex !== -1) {
          const body = input.slice(open.end, closeIndex);
          if (env === 'verbatim') {
            const code = body.replace(/^\n/, '').replace(/\n$/, '');
            out.push({ _type: 'code', _key: keys.block(), code, language: null });
          } else if (env === 'quote') {
            out.push(makeTextBlock(body.trim().replace(/\s+/g, ' '), 'blockquote', keys));
          } else if (env === 'itemize' || env === 'enumerate') {
            const listItem: 'bullet' | 'number' = env === 'enumerate' ? 'number' : 'bullet';
            for (const itemText of body.split('\\item').slice(1)) {
              out.push(makeTextBlock(itemText.trim().replace(/\s+/g, ' '), 'normal', keys, listItem));
            }
          } else {
            // Unknown environment — treat as a plain paragraph.
            out.push(makeTextBlock(body.trim().replace(/\s+/g, ' '), 'normal', keys));
          }
          i = closeIndex + closeMarker.length;
          continue;
        }
      }
    }

    // Top-level command (heading)
    if (input[i] === '\\') {
      const cmd = parseCommand(input, i);
      if (cmd && HEADING_FROM_COMMAND[cmd.name] && cmd.args.length === 1) {
        out.push(makeTextBlock(cmd.args[0]!, HEADING_FROM_COMMAND[cmd.name]!, keys));
        i = cmd.end;
        continue;
      }
    }

    // Plain paragraph: consume until a blank line or a recognised structural token.
    let end = i;
    while (end < input.length) {
      if (input.startsWith('\n\n', end)) break;
      if (input.startsWith('\\section', end)) break;
      if (input.startsWith('\\subsection', end)) break;
      if (input.startsWith('\\subsubsection', end)) break;
      if (input.startsWith('\\paragraph', end)) break;
      if (input.startsWith('\\subparagraph', end)) break;
      if (input.startsWith('\\begin{', end)) break;
      end += 1;
    }
    const para = input.slice(i, end).trim().replace(/\s+/g, ' ');
    if (para !== '') out.push(makeTextBlock(para, 'normal', keys));
    i = end;
  }
}

export function latexToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  parseDocument(input, out, keys);
  return out;
}

// --- Format ----------------------------------------------------------------

export const latexFormat: Format = {
  id: 'latex',
  label: 'LaTeX',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return latexToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToLatex(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/\\(section|subsection|subsubsection|paragraph)\{[^}]+\}/.test(value)) hits += 2;
    if (/\\begin\{(itemize|enumerate|quote|verbatim)\}/.test(value)) hits += 2;
    if (/\\(textbf|textit|emph|texttt|underline|sout)\{[^}]+\}/.test(value)) hits += 1;
    if (/\\href\{[^}]+\}\{[^}]+\}/.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default latexFormat;
