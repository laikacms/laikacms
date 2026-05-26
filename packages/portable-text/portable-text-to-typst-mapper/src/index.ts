import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Typst <-> Portable Text.
 *
 * Typst is a modern typesetting language (https://typst.app). The constructs
 * we model:
 *
 *   - `= H1` … `====== H6`            → block style `h1`..`h6`
 *   - `- item` / `+ item`              → list blocks (bullet / number)
 *   - ```` ```lang … ``` ````          → `code` block (with `language`)
 *   - `*bold*`                          → `strong` decorator
 *   - `_italic_`                        → `em` decorator
 *   - `` `code` ``                      → `code` decorator
 *   - `#link("…")[text]`                → `markDefs[link]`
 *   - `#quote[…]`                       → block style `blockquote`
 *   - `// line comment` and `/* … * /`  → stripped
 *
 * Math, raw blocks, and the wider Typst function ecosystem are intentionally
 * out of scope; unknown `#name[…]` calls are emitted as plain text.
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
    // `#link("url")[text]`
    if (input.startsWith('#link(', i)) {
      const open = input.indexOf('"', i + 6);
      const close = open === -1 ? -1 : input.indexOf('"', open + 1);
      const bracketOpen = close === -1 ? -1 : input.indexOf('[', close + 1);
      const bracketClose = bracketOpen === -1 ? -1 : findMatchingBracket(input, bracketOpen);
      if (open !== -1 && close !== -1 && bracketOpen !== -1 && bracketClose !== -1) {
        flushBuf();
        const url = input.slice(open + 1, close);
        const inner = parseInline(input.slice(bracketOpen + 1, bracketClose));
        for (const t of inner) {
          tokens.push({
            text: t.text,
            decorators: [...stack, ...t.decorators],
            link: t.link ?? url,
          });
        }
        i = bracketClose + 1;
        continue;
      }
    }
    // Inline code: backtick-delimited (Typst uses `text` like Markdown).
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1);
      if (end !== -1) {
        flushBuf();
        tokens.push({
          text: input.slice(i + 1, end),
          decorators: [...stack, 'code'],
        });
        i = end + 1;
        continue;
      }
    }
    // `*bold*` — must be a true paired delimiter (no space immediately
    // inside, can't be at start of a list-item line — handled at block layer).
    if (input[i] === '*' && input[i + 1] !== ' ' && input[i + 1] !== undefined) {
      const end = input.indexOf('*', i + 1);
      if (end !== -1 && input[end - 1] !== ' ') {
        flushBuf();
        const inner = parseInline(input.slice(i + 1, end));
        for (const t of inner) {
          tokens.push({ text: t.text, decorators: [...stack, 'strong', ...t.decorators] });
        }
        i = end + 1;
        continue;
      }
    }
    // `_italic_`
    if (input[i] === '_' && input[i + 1] !== ' ' && input[i + 1] !== undefined) {
      const end = input.indexOf('_', i + 1);
      if (end !== -1 && input[end - 1] !== ' ') {
        flushBuf();
        const inner = parseInline(input.slice(i + 1, end));
        for (const t of inner) {
          tokens.push({ text: t.text, decorators: [...stack, 'em', ...t.decorators] });
        }
        i = end + 1;
        continue;
      }
    }
    buf += input[i];
    i += 1;
  }
  flushBuf();
  return tokens;
}

function findMatchingBracket(input: string, open: number): number {
  let depth = 0;
  for (let i = open; i < input.length; i += 1) {
    const c = input[i];
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
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

const HEADING_RE = /^(=+)\s+(.+)$/;
const BULLET_RE = /^\s*-\s+(.*)$/;
const NUMBER_RE = /^\s*\+\s+(.*)$/;
const FENCE_RE = /^```([a-zA-Z0-9_+-]*)?\s*$/;
const QUOTE_RE = /^#quote\[(.+)\]\s*$/;

function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export function typstToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const cleaned = stripComments(input);
  const lines = cleaned.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Fenced code block.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const language = fence[1] || null;
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing ```
      out.push({
        _type: 'code',
        _key: keys.block(),
        code: codeLines.join('\n'),
        language,
      } as unknown as PortableTextBlock);
      continue;
    }

    // Heading.
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1]!.length);
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = tokensToSpans(parseInline(heading[2]!), markDefs, keys);
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

    // List item (bullet or numbered).
    const bMatch = BULLET_RE.exec(line);
    const nMatch = NUMBER_RE.exec(line);
    if (bMatch || nMatch) {
      const markDefs: PortableTextMarkDefinition[] = [];
      const text = (bMatch ?? nMatch)![1]!;
      const children = tokensToSpans(parseInline(text), markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs,
        children,
        listItem: bMatch ? 'bullet' : 'number',
        level: 1,
      } as PortableTextBlock);
      i += 1;
      continue;
    }

    // Single-line `#quote[…]`.
    const q = QUOTE_RE.exec(line);
    if (q) {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = tokensToSpans(parseInline(q[1]!), markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'blockquote',
        markDefs,
        children,
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
        || BULLET_RE.test(nl)
        || NUMBER_RE.test(nl)
        || FENCE_RE.test(nl)
        || QUOTE_RE.test(nl)
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

// --- PT -> Typst ----------------------------------------------------------

const DECORATOR_WRAP: Record<string, [string, string]> = {
  strong: ['*', '*'],
  em: ['_', '_'],
  code: ['`', '`'],
};

function spanToTypst(
  span: PortableTextSpan,
  markDefs: PortableTextMarkDefinition[],
): string {
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
    text = `#link("${href}")[${text}]`;
  }
  return text;
}

export function portableTextToTypst(doc: PortableTextDocument): string {
  const lines: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'code') {
      const code = String((block as { code?: unknown }).code ?? '');
      const language = (block as { language?: unknown }).language;
      lines.push(`\`\`\`${typeof language === 'string' && language ? language : ''}`);
      lines.push(code);
      lines.push('```');
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[])
      .map(s => spanToTypst(s, markDefs))
      .join('');
    if (b.listItem === 'bullet') {
      lines.push(`- ${text}`);
      continue;
    }
    if (b.listItem === 'number') {
      lines.push(`+ ${text}`);
      continue;
    }
    const style = b.style ?? 'normal';
    if (style === 'blockquote') {
      lines.push(`#quote[${text}]`);
      continue;
    }
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      lines.push(`${'='.repeat(Number(headingMatch[1]))} ${text}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join('\n');
}

// --- Format ---------------------------------------------------------------

export const typstFormat: Format = {
  id: 'typst',
  label: 'Typst',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return typstToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToTypst(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^=+\s+\S/m.test(value)) hits += 1;
    if (/#link\(/.test(value)) hits += 2;
    if (/#quote\[/.test(value)) hits += 2;
    if (/^\+\s+\S/m.test(value)) hits += 1; // Typst's `+` numbered marker is unusual
    if (/(^|\s)\*[^\s*][^*]*\*(\s|$)/.test(value)) hits += 1;
    if (/(^|\s)_[^\s_][^_]*_(\s|$)/.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default typstFormat;
