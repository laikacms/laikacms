import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * ZIM wiki <-> Portable Text.
 *
 * ZIM is the plain-text notebook format used by the eponymous desktop app.
 * Its most distinctive convention is *inverse-equals heading levels* — more
 * equals signs means a higher heading:
 *
 *     ======  H1  ======
 *     =====   H2  =====
 *     ====    H3  ====
 *     ===     H4  ===
 *     ==      H5  ==
 *
 * Other constructs we model:
 *
 *   - `**bold**`, `//italic//`, `__underline__`, `~~strike~~`, `''verbatim''`
 *     → `strong`, `em`, `underline`, `strike-through`, `code`
 *   - `_{x}` / `^{x}` → `sub` / `sup`
 *   - `* item` → bullet list block
 *   - `1. item` (or `a.`) → numbered list block
 *   - `[ ]` / `[*]` / `[x]` / `[>]` task markers preserve the marker as text
 *   - `[[Target]]` and `[[Target|Label]]` → `markDefs[link]` with
 *     `zim://page/<Target>` href (or the raw target if it already looks like
 *     a URL)
 *   - `{{image.png}}` → `image` block with `url`
 *   - `----` horizontal rule → `hr` block
 *   - `'''` ... `'''` (on their own lines) → `code` block
 *   - `@tag` text is preserved as-is
 *
 * Tables are intentionally out of scope.
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
  { delim: '~~', decorator: 'strike-through' },
  { delim: "''", decorator: 'code' },
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
    // `[[Target|Label]]` or `[[Target]]`
    if (input.startsWith('[[', i)) {
      const end = input.indexOf(']]', i + 2);
      if (end !== -1) {
        const inside = input.slice(i + 2, end);
        const pipe = inside.indexOf('|');
        const target = (pipe === -1 ? inside : inside.slice(0, pipe)).trim();
        const label = (pipe === -1 ? inside : inside.slice(pipe + 1)).trim();
        const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith('mailto:')
          ? target
          : `zim://page/${target}`;
        flushBuf();
        tokens.push({ text: label, decorators: [...stack], link: href });
        i = end + 2;
        continue;
      }
    }
    // `_{sub}` and `^{sup}`
    if ((input[i] === '_' || input[i] === '^') && input[i + 1] === '{') {
      const end = input.indexOf('}', i + 2);
      if (end !== -1) {
        flushBuf();
        const inner = input.slice(i + 2, end);
        tokens.push({
          text: inner,
          decorators: [...stack, input[i] === '_' ? 'sub' : 'sup'],
        });
        i = end + 1;
        continue;
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

// Balanced equals heading. Heading level: 6 equals → h1, ..., 2 equals → h5.
const HEADING_RE = /^(=+)\s+(.+?)\s+\1\s*$/;
const HR_RE = /^----+\s*$/;
const BULLET_RE = /^(\s*)\*\s+(.*)$/;
const NUMBERED_RE = /^(\s*)(?:\d+|[a-z])\.\s+(.*)$/;
const IMAGE_RE = /^\{\{([^}]+)\}\}\s*$/;
const VERBATIM_FENCE_RE = /^'''\s*$/;

export function zimToPortableText(input: string): PortableTextDocument {
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

    if (HR_RE.test(line)) {
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      i += 1;
      continue;
    }

    const imageMatch = IMAGE_RE.exec(line);
    if (imageMatch) {
      out.push({
        _type: 'image',
        _key: keys.block(),
        url: imageMatch[1]!.trim(),
        alt: '',
      } as unknown as PortableTextBlock);
      i += 1;
      continue;
    }

    if (VERBATIM_FENCE_RE.test(line)) {
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !VERBATIM_FENCE_RE.test(lines[i]!)) {
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
      // ZIM uses inverse-equals: 6 `=` → h1, 5 → h2, ..., 2 → h5.
      const eqCount = headingMatch[1]!.length;
      const level = Math.min(6, Math.max(1, 7 - eqCount));
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

    // Paragraph: collect consecutive non-special lines.
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
        || IMAGE_RE.test(nl)
        || VERBATIM_FENCE_RE.test(nl)
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

// --- PT -> ZIM ------------------------------------------------------------

const DECORATOR_WRAP: Record<string, [string, string]> = {
  strong: ['**', '**'],
  em: ['//', '//'],
  underline: ['__', '__'],
  'strike-through': ['~~', '~~'],
  code: ["''", "''"],
};
const SUB_SUP_WRAP: Record<string, [string, string]> = {
  sub: ['_{', '}'],
  sup: ['^{', '}'],
};

function spanToZim(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = span.text;
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  for (const mark of marks) {
    if (mark === linkKey) continue;
    const wrap = DECORATOR_WRAP[mark] ?? SUB_SUP_WRAP[mark];
    if (wrap) text = `${wrap[0]}${text}${wrap[1]}`;
  }
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    if (href.startsWith('zim://page/')) {
      const target = href.slice('zim://page/'.length);
      text = text === target ? `[[${target}]]` : `[[${target}|${text}]]`;
    } else {
      text = text === href ? `[[${href}]]` : `[[${href}|${text}]]`;
    }
  }
  return text;
}

export function portableTextToZim(doc: PortableTextDocument): string {
  const lines: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      lines.push('----');
      continue;
    }
    if (t === 'image') {
      lines.push(`{{${String((block as { url?: unknown }).url ?? '')}}}`);
      continue;
    }
    if (t === 'code') {
      const code = String((block as { code?: unknown }).code ?? '');
      lines.push("'''");
      lines.push(code);
      lines.push("'''");
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToZim(s, markDefs)).join('');
    if (b.listItem === 'bullet' || b.listItem === 'number') {
      const indent = '  '.repeat(Math.max(0, (b.level ?? 1) - 1));
      const marker = b.listItem === 'number' ? '1.' : '*';
      lines.push(`${indent}${marker} ${text}`);
      continue;
    }
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      const level = Number(headingMatch[1]);
      const eq = '='.repeat(7 - level);
      lines.push(`${eq} ${text} ${eq}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join('\n');
}

// --- Format ---------------------------------------------------------------

export const zimFormat: Format = {
  id: 'zim',
  label: 'ZIM wiki',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return zimToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToZim(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^={2,6}\s.+\s={2,6}\s*$/m.test(value)) hits += 1;
    if (/^={6}\s/m.test(value)) hits += 2; // characteristic h1 line
    if (/\[\[[^\]\n|]+\]\]/.test(value)) hits += 1;
    if (/\{\{[^}\n]+\}\}/.test(value)) hits += 1;
    if (/''[^'\n]+''/.test(value)) hits += 1;
    if (/^'''\s*$/m.test(value)) hits += 1;
    return Math.min(1, hits * 0.22);
  },
};

export default zimFormat;
