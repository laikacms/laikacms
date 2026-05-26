import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Vimwiki <-> Portable Text.
 *
 * Vimwiki is the Vim plugin's plain-text wiki format. The constructs we model:
 *
 *   Blocks:
 *     - Headers: `= H1 =` … `====== H6 ======` (balanced equals)
 *     - Bullet list: `* item` or `- item` (2-space indent → nested level)
 *     - Numbered list: `1. item`, `# item` (auto-numbered)
 *     - Code block: `{{{` … `}}}` on their own lines
 *     - Horizontal rule: `----` (4+ dashes)
 *
 *   Inline (single-character delimiters distinguish Vimwiki from
 *   MoinMoin/Markdown):
 *     - Bold:           `*bold*`
 *     - Italic:         `_italic_`
 *     - Strikethrough:  `~~strike~~`
 *     - Inline code:    `` `code` ``
 *     - Superscript:    `^text^`
 *     - Subscript:      `,,text,,`
 *
 *   Links:
 *     - `[[Target]]` / `[[Target|Description]]` → `vimwiki://page/<target>`
 *       (or the raw target if it already looks like a URL/mailto)
 *     - `[[file:/path|name]]` keeps the explicit URL
 *
 *   Comments: `%% line comment` → stripped
 *
 * Tables (`| cell | cell |`) and Vimwiki's "markdown syntax" variant are
 * intentionally out of scope.
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

// --- Inline parser --------------------------------------------------------

interface InlineToken {
  text: string;
  decorators: string[];
  link?: string;
}

interface PairRule {
  open: string;
  close: string;
  decorator: string;
}

const PAIR_RULES: PairRule[] = [
  { open: '~~', close: '~~', decorator: 'strike-through' },
  { open: ',,', close: ',,', decorator: 'sub' },
];

// Single-char rules need a different opening/closing predicate to avoid matching
// stray asterisks or underscores in the middle of words; they are applied
// inside the main loop with stricter boundary checks.
const SINGLE_CHAR_RULES: Array<{ char: string, decorator: string }> = [
  { char: '*', decorator: 'strong' },
  { char: '_', decorator: 'em' },
  { char: '`', decorator: 'code' },
  { char: '^', decorator: 'sup' },
];

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function parseInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let buf = '';
  const stack: string[] = [];
  const flushBuf = (): void => {
    if (buf.length) {
      tokens.push({ text: buf, decorators: [...stack] });
      buf = '';
    }
  };

  while (i < input.length) {
    // `[[Target|Description]]` or `[[Target]]`
    if (input.startsWith('[[', i)) {
      const end = input.indexOf(']]', i + 2);
      if (end !== -1) {
        const inside = input.slice(i + 2, end);
        const pipe = inside.indexOf('|');
        const targetRaw = (pipe === -1 ? inside : inside.slice(0, pipe)).trim();
        const label = (pipe === -1 ? inside : inside.slice(pipe + 1)).trim();
        const href = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|file:)/i.test(targetRaw)
          ? targetRaw
          : `vimwiki://page/${targetRaw}`;
        flushBuf();
        tokens.push({ text: label, decorators: [...stack], link: href });
        i = end + 2;
        continue;
      }
    }
    // Two-char pair rules.
    let matched = false;
    for (const rule of PAIR_RULES) {
      if (input.startsWith(rule.open, i)) {
        const after = i + rule.open.length;
        const end = input.indexOf(rule.close, after);
        if (end !== -1 && end > after) {
          const inner = input.slice(after, end);
          if (!inner.includes('\n')) {
            flushBuf();
            const innerTokens = parseInline(inner);
            for (const t of innerTokens) {
              tokens.push({
                ...t,
                decorators: [...stack, rule.decorator, ...t.decorators],
              });
            }
            i = end + rule.close.length;
            matched = true;
            break;
          }
        }
      }
    }
    if (matched) continue;

    // Single-char delimiters with boundary checks. To open, the previous char
    // must not be a word char and the next must not be whitespace; to close,
    // mirrored.
    const here = input[i]!;
    const rule = SINGLE_CHAR_RULES.find(r => r.char === here);
    if (rule) {
      const prev = i === 0 ? undefined : input[i - 1];
      const next = input[i + 1];
      const canOpen = !isWordChar(prev) && next !== undefined && next !== ' ' && next !== '\n' && next !== '\t';
      if (canOpen) {
        // Find a matching close: the same char preceded by non-space and not
        // followed by a word char.
        let j = i + 1;
        while (j < input.length) {
          if (input[j] === '\n') break;
          if (input[j] === rule.char) {
            const beforeClose = input[j - 1];
            const afterClose = input[j + 1];
            if (beforeClose !== ' ' && !isWordChar(afterClose)) {
              break;
            }
          }
          j += 1;
        }
        if (j < input.length && input[j] === rule.char) {
          const inner = input.slice(i + 1, j);
          flushBuf();
          // Code is a hard decorator — don't recurse into its body.
          if (rule.decorator === 'code') {
            tokens.push({ text: inner, decorators: [...stack, 'code'] });
          } else {
            const innerTokens = parseInline(inner);
            for (const t of innerTokens) {
              tokens.push({
                ...t,
                decorators: [...stack, rule.decorator, ...t.decorators],
              });
            }
          }
          i = j + 1;
          continue;
        }
      }
    }

    buf += here;
    i += 1;
  }
  flushBuf();
  return tokens;
}

function tokensToSpans(
  tokens: InlineToken[],
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
): PortableTextSpan[] {
  return tokens.map(t => {
    const marks = [...t.decorators];
    if (t.link) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: t.link });
      marks.push(key);
    }
    return { _type: 'span', _key: keys.span(), text: t.text, marks };
  });
}

// --- Block parser ---------------------------------------------------------

const HEADING_RE = /^(=+)\s+(.+?)\s+\1\s*$/;
const HR_RE = /^----+\s*$/;
const BULLET_RE = /^(\s*)[*-]\s+(.*)$/;
const NUMBERED_RE = /^(\s*)(?:\d+\.|#)\s+(.*)$/;
const CODE_OPEN_RE = /^\{\{\{\s*$/;
const CODE_CLOSE_RE = /^\}\}\}\s*$/;
const COMMENT_RE = /^\s*%%/;

export function vimwikiToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const lines = input.split(/\r?\n/).filter(l => !COMMENT_RE.test(l));
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      i += 1;
      continue;
    }

    if (CODE_OPEN_RE.test(line)) {
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !CODE_CLOSE_RE.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push({
        _type: 'code',
        _key: keys.block(),
        code: codeLines.join('\n'),
        language: null,
      } as unknown as PortableTextBlock);
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1]!.length);
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = tokensToSpans(parseInline(headingMatch[2]!), markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: `h${level}`,
        markDefs,
        children,
      } as PortableTextBlock);
      i += 1;
      continue;
    }

    const bMatch = BULLET_RE.exec(line);
    const nMatch = NUMBERED_RE.exec(line);
    if (bMatch || nMatch) {
      const match = bMatch ?? nMatch!;
      const indent = match[1]!.length;
      const text = match[2]!;
      const level = Math.floor(indent / 2) + 1;
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = tokensToSpans(parseInline(text), markDefs, keys);
      const block: PortableTextBlock = {
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs,
        children,
      };
      (block as PortableTextBlock & { listItem: string, level: number }).listItem = bMatch ? 'bullet' : 'number';
      (block as PortableTextBlock & { listItem: string, level: number }).level = level;
      out.push(block);
      i += 1;
      continue;
    }

    // Paragraph: gather consecutive non-special lines.
    const paraLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const nl = lines[j]!;
      if (
        nl.trim() === ''
        || HEADING_RE.test(nl)
        || HR_RE.test(nl)
        || BULLET_RE.test(nl)
        || NUMBERED_RE.test(nl)
        || CODE_OPEN_RE.test(nl)
      ) break;
      paraLines.push(nl);
      j += 1;
    }
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = tokensToSpans(parseInline(paraLines.join('\n')), markDefs, keys);
    out.push({
      _type: 'block',
      _key: keys.block(),
      style: 'normal',
      markDefs,
      children,
    } as PortableTextBlock);
    i = j;
  }

  return out;
}

// --- PT -> Vimwiki --------------------------------------------------------

const DECORATOR_WRAP: Record<string, [string, string]> = {
  strong: ['*', '*'],
  em: ['_', '_'],
  'strike-through': ['~~', '~~'],
  code: ['`', '`'],
  sup: ['^', '^'],
  sub: [',,', ',,'],
};

function spanToVimwiki(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text;
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  for (const mark of marks) {
    if (mark === linkKey) continue;
    const wrap = DECORATOR_WRAP[mark];
    if (wrap) text = `${wrap[0]}${text}${wrap[1]}`;
  }
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    if (href.startsWith('vimwiki://page/')) {
      const target = href.slice('vimwiki://page/'.length);
      text = text === target ? `[[${target}]]` : `[[${target}|${text}]]`;
    } else {
      text = text === href ? `[[${href}]]` : `[[${href}|${text}]]`;
    }
  }
  return text;
}

export function portableTextToVimwiki(doc: PortableTextDocument): string {
  const lines: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      lines.push('----');
      continue;
    }
    if (t === 'code') {
      const code = String((block as { code?: unknown }).code ?? '');
      lines.push('{{{');
      lines.push(code);
      lines.push('}}}');
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToVimwiki(s, markDefs)).join('');
    if (b.listItem === 'bullet' || b.listItem === 'number') {
      const indent = '  '.repeat(Math.max(0, (b.level ?? 1) - 1));
      const marker = b.listItem === 'number' ? '1.' : '*';
      lines.push(`${indent}${marker} ${text}`);
      continue;
    }
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      const eq = '='.repeat(Number(headingMatch[1]));
      lines.push(`${eq} ${text} ${eq}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join('\n');
}

// --- Format ---------------------------------------------------------------

export const vimwikiFormat: Format = {
  id: 'vimwiki',
  label: 'Vimwiki',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return vimwikiToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToVimwiki(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^=+\s.+\s=+\s*$/m.test(value)) hits += 1;
    if (/\[\[[^\]\n]+\]\]/.test(value)) hits += 1;
    if (/^\{\{\{\s*$/m.test(value)) hits += 1;
    if (/^%%\s/m.test(value)) hits += 2;
    if (/(^|\s),,[^,\n\s][^,\n]*?,,(\s|$)/.test(value)) hits += 1;
    if (/^\s*#\s+\S/m.test(value)) hits += 1; // # numbered marker (distinctive)
    return Math.min(1, hits * 0.22);
  },
};

export default vimwikiFormat;
