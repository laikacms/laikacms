import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * txt2tags <-> Portable Text.
 *
 * txt2tags (.t2t) is a plain-text source format that compiles to many
 * backends (HTML, LaTeX, Man, etc.). The subset we cover:
 *
 *   - Headings (un-numbered): `= H1 =` … `===== H5 =====` (balanced)
 *   - Headings (numbered):    `+ H1 +` … `+++++ H5 +++++`
 *   - Bold:    `**bold**`
 *   - Italic:  `//italic//`
 *   - Under:   `__under__`
 *   - Strike:  `--strike--`
 *   - Mono:    `` ``code`` ``
 *   - Bullet list:   `- item`
 *   - Numbered list: `+ item`  (single trailing `+` on a list item, vs the
 *                                balanced pair that marks a numbered heading)
 *   - Code block: fenced by lines that contain only ``` ``` ```
 *   - Horizontal rule: 20+ `-` or `=` characters on a line
 *   - Link: `[label url]` (two whitespace-separated tokens in `[ ]`) or
 *           `[url]` (single token) — protocol prefix detected
 *   - `%` line comment, `%!setting: value` config directive — both dropped
 *
 * Tables, description lists, raw / tagged spans, and image embeds are
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

const INLINE_RULES: Array<{ delim: string, decorator: string }> = [
  { delim: '**', decorator: 'strong' },
  { delim: '//', decorator: 'em' },
  { delim: '__', decorator: 'underline' },
  { delim: '--', decorator: 'strike-through' },
  { delim: '``', decorator: 'code' },
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
    // `[label url]` or `[url]`
    if (input[i] === '[') {
      const end = input.indexOf(']', i + 1);
      if (end !== -1) {
        const inside = input.slice(i + 1, end).trim();
        // Pick the rightmost whitespace as separator so the label can have
        // spaces; if no whitespace, treat the whole thing as both label and
        // url.
        const ws = inside.search(/\s+\S+$/);
        let label: string;
        let url: string;
        if (ws !== -1) {
          label = inside.slice(0, ws).trim();
          url = inside.slice(ws).trim();
        } else {
          label = inside;
          url = inside;
        }
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(?:#|\/|mailto:)/.test(url) || ws !== -1) {
          flushBuf();
          tokens.push({ text: label, decorators: [...stack], link: url });
          i = end + 1;
          continue;
        }
      }
    }
    // Decorator pairs.
    let matched = false;
    for (const rule of INLINE_RULES) {
      if (input.startsWith(rule.delim, i)) {
        const after = i + rule.delim.length;
        const end = input.indexOf(rule.delim, after);
        if (end !== -1 && end > after) {
          const innerRaw = input.slice(after, end);
          if (!innerRaw.includes('\n')) {
            flushBuf();
            const innerTokens = parseInline(innerRaw);
            for (const t of innerTokens) {
              tokens.push({
                ...t,
                decorators: [...stack, rule.decorator, ...t.decorators],
              });
            }
            i = end + rule.delim.length;
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

const HEADING_RE = /^(=+)\s+(.+?)\s+\1\s*$/;
const NUMBERED_HEADING_RE = /^(\++)\s+(.+?)\s+\1\s*$/;
const BULLET_RE = /^-\s+(.*)$/;
const NUMBERED_LIST_RE = /^\+\s+(.*)$/;
const HR_RE = /^(?:-{20,}|={20,})\s*$/;
const FENCE_RE = /^```\s*$/;

function isComment(line: string): boolean {
  return /^\s*%/.test(line);
}

export function txt2tagsToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const lines = input.split(/\r?\n/).filter(l => !isComment(l));
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

    if (FENCE_RE.test(line)) {
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !FENCE_RE.test(lines[i]!)) {
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

    const heading = HEADING_RE.exec(line) ?? NUMBERED_HEADING_RE.exec(line);
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

    const bMatch = BULLET_RE.exec(line);
    const nMatch = NUMBERED_LIST_RE.exec(line);
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

    // Paragraph: gather consecutive non-blank, non-special lines.
    const paraLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const nl = lines[j]!;
      if (
        nl.trim() === ''
        || HEADING_RE.test(nl)
        || NUMBERED_HEADING_RE.test(nl)
        || BULLET_RE.test(nl)
        || NUMBERED_LIST_RE.test(nl)
        || HR_RE.test(nl)
        || FENCE_RE.test(nl)
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

// --- PT -> txt2tags -------------------------------------------------------

const DECORATOR_WRAP: Record<string, [string, string]> = {
  strong: ['**', '**'],
  em: ['//', '//'],
  underline: ['__', '__'],
  'strike-through': ['--', '--'],
  code: ['``', '``'],
};

function spanToTxt2tags(
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
    text = text === href ? `[${href}]` : `[${text} ${href}]`;
  }
  return text;
}

export function portableTextToTxt2tags(doc: PortableTextDocument): string {
  const lines: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      lines.push('-'.repeat(30));
      continue;
    }
    if (t === 'code') {
      const code = String((block as { code?: unknown }).code ?? '');
      lines.push('```');
      lines.push(code);
      lines.push('```');
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[])
      .map(s => spanToTxt2tags(s, markDefs))
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

export const txt2tagsFormat: Format = {
  id: 'txt2tags',
  label: 'txt2tags',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return txt2tagsToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToTxt2tags(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^=+\s.+\s=+\s*$/m.test(value)) hits += 1;
    if (/^\++\s.+\s\++\s*$/m.test(value)) hits += 2; // numbered heading
    if (/\*\*[^*\n]+\*\*/.test(value)) hits += 1;
    if (/\/\/[^/\n]+\/\//.test(value)) hits += 1;
    if (/^%![\w-]+:/m.test(value)) hits += 2; // config directive
    if (/^-{20,}\s*$/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default txt2tagsFormat;
