import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Wikidot wiki markup <-> Portable Text.
 *
 * Wikidot powers SCP Foundation and many other collaborative sites. The
 * constructs we model:
 *
 *   Blocks:
 *     - Headings: `+ H1`, `++ H2`, … `++++++ H6`
 *     - Bullet list: `* item`
 *     - Numbered list: `# item`
 *     - Block quote: `> text` (consecutive lines)
 *     - Code block: `[[code]]` … `[[/code]]` (case-insensitive, optional
 *       `type=` parameter)
 *     - Horizontal rule: `----` (4+ dashes on their own line)
 *
 *   Inline:
 *     - `**bold**`     → `strong`
 *     - `//italic//`   → `em`
 *     - `__under__`    → `underline`
 *     - `--strike--`   → `strike-through`
 *     - `^^sup^^`      → `sup`
 *     - `,,sub,,`      → `sub`
 *     - `{{mono}}`     → `code`
 *     - `@@code@@`     → `code` (Wikidot's alternative inline-code form)
 *
 *   Links:
 *     - `[URL Display Text]` → external link with the leading token as URL
 *     - `[[[Page|Display]]]` → wiki link with `wikidot://page/<page>` href
 *     - `[[[Page]]]`         → wiki link (display = page name)
 *
 *   Comments: `[!-- … --]` → stripped
 *   `[[div]]` / `[[/div]]`, `[[note]]` / `[[/note]]` and other module
 *   wrappers are flattened: the module is dropped, its body is kept.
 *
 * Tables and the broader Wikidot module ecosystem are intentionally out of
 * scope.
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

const PAIR_RULES: Array<{ open: string, close: string, decorator: string }> = [
  { open: '**', close: '**', decorator: 'strong' },
  { open: '//', close: '//', decorator: 'em' },
  { open: '__', close: '__', decorator: 'underline' },
  { open: '--', close: '--', decorator: 'strike-through' },
  { open: '^^', close: '^^', decorator: 'sup' },
  { open: ',,', close: ',,', decorator: 'sub' },
  { open: '{{', close: '}}', decorator: 'code' },
  { open: '@@', close: '@@', decorator: 'code' },
];

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
    // `[[[Page|Display]]]` or `[[[Page]]]`
    if (input.startsWith('[[[', i)) {
      const end = input.indexOf(']]]', i + 3);
      if (end !== -1) {
        const inside = input.slice(i + 3, end);
        const pipe = inside.indexOf('|');
        const target = (pipe === -1 ? inside : inside.slice(0, pipe)).trim();
        const label = (pipe === -1 ? inside : inside.slice(pipe + 1)).trim();
        flushBuf();
        tokens.push({
          text: label,
          decorators: [...stack],
          link: `wikidot://page/${target}`,
        });
        i = end + 3;
        continue;
      }
    }
    // `[URL Display Text]` (external link). Single `[` then a token, space,
    // then display text up to the matching `]`. Must not start a `[[`.
    if (input[i] === '[' && input[i + 1] !== '[') {
      const end = input.indexOf(']', i + 1);
      if (end !== -1) {
        const inside = input.slice(i + 1, end);
        const spaceAt = inside.search(/\s/);
        if (spaceAt > 0 && /^[#a-z][a-z0-9+.-]*:\/?\/?[^\s]*$/i.test(inside.slice(0, spaceAt))) {
          flushBuf();
          tokens.push({
            text: inside.slice(spaceAt + 1).trim(),
            decorators: [...stack],
            link: inside.slice(0, spaceAt),
          });
          i = end + 1;
          continue;
        }
      }
    }
    // Two-char decorator pair.
    let matched = false;
    for (const rule of PAIR_RULES) {
      if (input.startsWith(rule.open, i)) {
        const after = i + rule.open.length;
        const end = input.indexOf(rule.close, after);
        if (end !== -1 && end > after) {
          const innerRaw = input.slice(after, end);
          if (!innerRaw.includes('\n')) {
            flushBuf();
            if (rule.decorator === 'code') {
              tokens.push({ text: innerRaw, decorators: [...stack, 'code'] });
            } else {
              const innerTokens = parseInline(innerRaw);
              for (const t of innerTokens) {
                tokens.push({
                  ...t,
                  decorators: [...stack, rule.decorator, ...t.decorators],
                });
              }
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

const HEADING_RE = /^(\++)\s+(.+)$/;
const BULLET_RE = /^(\s*)\*\s+(.*)$/;
const NUMBERED_RE = /^(\s*)#\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^-{4,}\s*$/;
// Module wrappers: `[[name ...]]` and `[[/name]]`. We use these to flatten
// content out of unknown module bodies.
const MODULE_OPEN_RE = /^\[\[([a-zA-Z][\w-]*)([^\]]*)\]\]\s*$/;
const MODULE_CLOSE_RE = /^\[\[\/([a-zA-Z][\w-]*)\]\]\s*$/;

function stripComments(input: string): string {
  return input.replace(/\[!--[\s\S]*?--\]/g, '');
}

export function wikidotToPortableText(input: string): PortableTextDocument {
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

    if (HR_RE.test(line)) {
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      i += 1;
      continue;
    }

    // Code block via [[code]] ... [[/code]] (case-insensitive).
    const codeOpen = /^\[\[code(?:\s+([^\]]*))?\]\]\s*$/i.exec(line);
    if (codeOpen) {
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !/^\[\[\/code\]\]\s*$/i.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      // Extract language from `type="lang"` if present.
      const langMatch = /type\s*=\s*"([^"]+)"/.exec(codeOpen[1] ?? '');
      out.push({
        _type: 'code',
        _key: keys.block(),
        code: codeLines.join('\n'),
        language: langMatch ? langMatch[1]! : null,
      } as unknown as PortableTextBlock);
      continue;
    }

    // Skip unknown module wrappers (consume open + close, leave body in place).
    const modOpen = MODULE_OPEN_RE.exec(line);
    if (modOpen && modOpen[1]!.toLowerCase() !== 'code') {
      i += 1;
      continue;
    }
    if (MODULE_CLOSE_RE.test(line)) {
      i += 1;
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

    // Blockquote: consecutive `> ` lines.
    if (QUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const m = QUOTE_RE.exec(lines[i]!);
        if (!m) break;
        quoteLines.push(m[1] ?? '');
        i += 1;
      }
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = tokensToSpans(parseInline(quoteLines.join('\n')), markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'blockquote',
        markDefs,
        children,
      } as PortableTextBlock);
      continue;
    }

    // Paragraph.
    const paraLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const nl = lines[j]!;
      if (
        nl.trim() === ''
        || HEADING_RE.test(nl)
        || BULLET_RE.test(nl)
        || NUMBERED_RE.test(nl)
        || QUOTE_RE.test(nl)
        || HR_RE.test(nl)
        || /^\[\[code/i.test(nl)
        || MODULE_OPEN_RE.test(nl)
        || MODULE_CLOSE_RE.test(nl)
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

// --- PT -> Wikidot --------------------------------------------------------

const DECORATOR_WRAP: Record<string, [string, string]> = {
  strong: ['**', '**'],
  em: ['//', '//'],
  underline: ['__', '__'],
  'strike-through': ['--', '--'],
  sup: ['^^', '^^'],
  sub: [',,', ',,'],
  code: ['{{', '}}'],
};

function spanToWikidot(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
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
    if (href.startsWith('wikidot://page/')) {
      const target = href.slice('wikidot://page/'.length);
      text = text === target ? `[[[${target}]]]` : `[[[${target}|${text}]]]`;
    } else {
      text = `[${href} ${text}]`;
    }
  }
  return text;
}

export function portableTextToWikidot(doc: PortableTextDocument): string {
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
      const open = typeof language === 'string' && language ? `[[code type="${language}"]]` : '[[code]]';
      lines.push(open);
      lines.push(code);
      lines.push('[[/code]]');
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToWikidot(s, markDefs)).join('');
    if (b.listItem === 'bullet' || b.listItem === 'number') {
      const indent = '  '.repeat(Math.max(0, (b.level ?? 1) - 1));
      const marker = b.listItem === 'number' ? '#' : '*';
      lines.push(`${indent}${marker} ${text}`);
      continue;
    }
    const style = b.style ?? 'normal';
    if (style === 'blockquote') {
      for (const ln of text.split('\n')) lines.push(`> ${ln}`);
      continue;
    }
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      const plus = '+'.repeat(Number(headingMatch[1]));
      lines.push(`${plus} ${text}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join('\n');
}

// --- Format ---------------------------------------------------------------

export const wikidotFormat: Format = {
  id: 'wikidot',
  label: 'Wikidot',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return wikidotToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToWikidot(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^\++\s\S/m.test(value)) hits += 2; // distinctive heading marker
    if (/\[\[\[[^\]\n]+\]\]\]/.test(value)) hits += 2; // triple-bracket wiki link
    if (/^\[\[code\b/im.test(value)) hits += 2;
    if (/^\[!--/m.test(value)) hits += 2;
    if (/\^\^[^^\n]+\^\^|,,[^,\n]+,,/.test(value)) hits += 1;
    return Math.min(1, hits * 0.22);
  },
};

export default wikidotFormat;
