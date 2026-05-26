import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * MoinMoin wiki markup <-> Portable Text.
 *
 * MoinMoin 1.9 syntax we model:
 *   - Headings:        `= H1 =` ... `===== H5 =====` (balanced equals)
 *   - Bold:            `'''text'''`
 *   - Italic:          `''text''`
 *   - Underline:       `__text__`
 *   - Strikethrough:   `--(text)--`
 *   - Superscript:     `^text^`
 *   - Subscript:       `,,text,,`
 *   - Inline code:     ` {{{code}}} `
 *   - Code block:      `{{{` line ... `}}}` line
 *   - Links:           `[[target|description]]`
 *   - Bullet list:     ` * item` (one leading space)
 *   - Numbered list:   ` 1. item` (one leading space)
 *   - Horizontal rule: `----`
 *
 * Tables and macros are deliberately out of scope for the initial cut.
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

const INLINE_RULES: Array<{ open: string, close: string, decorator: string }> = [
  { open: "'''", close: "'''", decorator: 'strong' },
  { open: "''", close: "''", decorator: 'em' },
  { open: '__', close: '__', decorator: 'underline' },
  { open: '--(', close: ')--', decorator: 'strike-through' },
  { open: '^', close: '^', decorator: 'sup' },
  { open: ',,', close: ',,', decorator: 'sub' },
];

function parseInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let buf = '';
  const decoratorStack: string[] = [];
  const flushBuf = (): void => {
    if (buf.length) {
      tokens.push({ text: buf, decorators: [...decoratorStack] });
      buf = '';
    }
  };

  while (i < input.length) {
    // Inline code `{{{...}}}`.
    if (input.startsWith('{{{', i)) {
      const end = input.indexOf('}}}', i + 3);
      if (end !== -1) {
        flushBuf();
        tokens.push({ text: input.slice(i + 3, end), decorators: [...decoratorStack, 'code'] });
        i = end + 3;
        continue;
      }
    }
    // Link `[[target|description]]` or `[[target]]`.
    if (input.startsWith('[[', i)) {
      const end = input.indexOf(']]', i + 2);
      if (end !== -1) {
        const inside = input.slice(i + 2, end);
        const pipe = inside.indexOf('|');
        const target = (pipe === -1 ? inside : inside.slice(0, pipe)).trim();
        const description = pipe === -1 ? target : inside.slice(pipe + 1).trim();
        flushBuf();
        // The link body itself can be styled, so recurse.
        for (const t of parseInline(description)) {
          tokens.push({ ...t, decorators: [...decoratorStack, ...t.decorators], link: target });
        }
        i = end + 2;
        continue;
      }
    }
    // Decorator pairs.
    let matched = false;
    for (const rule of INLINE_RULES) {
      if (input.startsWith(rule.open, i)) {
        const after = i + rule.open.length;
        const end = input.indexOf(rule.close, after);
        if (end !== -1 && end > after) {
          // Avoid greedy match where `^` decorator would eat a long span across
          // an unrelated `^`; the closer must not be followed by another open
          // of the same kind right after (best-effort heuristic).
          const innerRaw = input.slice(after, end);
          if (innerRaw.length > 0 && !innerRaw.includes('\n')) {
            flushBuf();
            const innerTokens = parseInline(innerRaw);
            for (const t of innerTokens) {
              tokens.push({
                ...t,
                decorators: [...decoratorStack, rule.decorator, ...t.decorators],
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
    buf += input[i];
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
  const spans: PortableTextSpan[] = [];
  for (const t of tokens) {
    const marks = [...t.decorators];
    if (t.link) {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: t.link });
      marks.push(key);
    }
    spans.push({ _type: 'span', _key: keys.span(), text: t.text, marks });
  }
  return spans;
}

// --- Block parser ---------------------------------------------------------

const HEADING_RE = /^(=+)\s+(.+?)\s+\1\s*$/;
const HR_RE = /^----+\s*$/;
const BULLET_RE = /^(\s+)\*\s+(.*)$/;
const NUMBER_RE = /^(\s+)\d+\.\s+(.*)$/;

export function moinMoinToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const lines = input.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(line)) {
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      i += 1;
      continue;
    }

    // Heading.
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

    // Fenced code block: standalone `{{{` to `}}}` lines.
    if (line.trim() === '{{{') {
      i += 1;
      const codeLines: string[] = [];
      // Optional `#!language` line.
      let language: string | null = null;
      const first = lines[i];
      if (typeof first === 'string' && /^#!/.test(first)) {
        language = first.replace(/^#!/, '').trim() || null;
        i += 1;
      }
      while (i < lines.length && lines[i]!.trim() !== '}}}') {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing `}}}`
      out.push({
        _type: 'code',
        _key: keys.block(),
        code: codeLines.join('\n'),
        language,
      } as unknown as PortableTextBlock);
      continue;
    }

    // List item (bullet or numbered).
    const bMatch = BULLET_RE.exec(line);
    const nMatch = NUMBER_RE.exec(line);
    if (bMatch || nMatch) {
      const isNumbered = !!nMatch;
      const match = bMatch ?? nMatch!;
      const indent = match[1]!.length;
      const text = match[2]!;
      const level = Math.max(1, indent);
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = tokensToSpans(parseInline(text), markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs,
        children,
        listItem: isNumbered ? 'number' : 'bullet',
        level,
      } as PortableTextBlock);
      i += 1;
      continue;
    }

    // Paragraph: accumulate consecutive non-blank, non-special lines.
    const paraLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const nl = lines[j]!;
      if (
        nl.trim() === ''
        || HEADING_RE.test(nl)
        || HR_RE.test(nl)
        || BULLET_RE.test(nl)
        || NUMBER_RE.test(nl)
        || nl.trim() === '{{{'
      ) break;
      paraLines.push(nl);
      j += 1;
    }
    const text = paraLines.join('\n');
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = tokensToSpans(parseInline(text), markDefs, keys);
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

// --- PT -> MoinMoin -------------------------------------------------------

const DECORATOR_WRAP: Record<string, [string, string]> = {
  strong: ["'''", "'''"],
  em: ["''", "''"],
  underline: ['__', '__'],
  'strike-through': ['--(', ')--'],
  sup: ['^', '^'],
  sub: [',,', ',,'],
  code: ['{{{', '}}}'],
};

function spanToMoinMoin(
  span: PortableTextSpan,
  markDefs: PortableTextMarkDefinition[],
): string {
  let text = span.text;
  const linkKey = (span.marks ?? []).find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  // Apply decorators inner-most-first; order doesn't matter much for symmetric
  // delimiters but keeps round-trips stable when paired with the same parser.
  for (const mark of span.marks ?? []) {
    if (mark === linkKey) continue;
    const wrap = DECORATOR_WRAP[mark];
    if (wrap) text = `${wrap[0]}${text}${wrap[1]}`;
  }
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    text = text === href ? `[[${href}]]` : `[[${href}|${text}]]`;
  }
  return text;
}

export function portableTextToMoinMoin(doc: PortableTextDocument): string {
  const lines: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      lines.push('----');
      continue;
    }
    if (t === 'code') {
      const code = String((block as { code?: unknown }).code ?? '');
      const language = (block as { language?: unknown }).language;
      lines.push('{{{');
      if (typeof language === 'string' && language) lines.push(`#!${language}`);
      lines.push(code);
      lines.push('}}}');
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[])
      .map(s => spanToMoinMoin(s, markDefs))
      .join('');
    if (b.listItem) {
      const indent = ' '.repeat(Math.max(1, b.level ?? 1));
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

export const moinMoinFormat: Format = {
  id: 'moinmoin',
  label: 'MoinMoin wiki markup',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return moinMoinToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToMoinMoin(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^=+\s.+\s=+\s*$/m.test(value)) hits += 2; // balanced-equals heading
    if (/^\s+\*\s+/m.test(value)) hits += 1;
    if (/'''[^'\n]+'''/.test(value)) hits += 1;
    if (/\[\[[^\]\n]+\]\]/.test(value)) hits += 1;
    if (/^----+$/m.test(value)) hits += 1;
    if (/^\{\{\{$/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default moinMoinFormat;
