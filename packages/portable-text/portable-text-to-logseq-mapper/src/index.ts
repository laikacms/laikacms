import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Logseq <-> Portable Text.
 *
 * Logseq stores notes as outlines: each line starting with `-` (at some
 * indentation) is its own *block*, and child blocks are indented underneath.
 * This is a fundamentally different shape from the flat-paragraph model of
 * Markdown / HTML, so we map the outline onto Portable Text bullet-list
 * blocks whose `level` reflects nesting depth:
 *
 *     - parent             →  block(listItem='bullet', level=1)
 *       - child            →  block(listItem='bullet', level=2)
 *         - grandchild     →  block(listItem='bullet', level=3)
 *
 * Round-trip is stable because outline depth ↔ `level` is bijective.
 *
 * Other Logseq conventions we model:
 *
 *   - Page properties at the very top of the file (`title:: …` / `tags:: …`,
 *     etc. with no leading `-`) → custom `logseq:page-properties` block
 *   - Block properties (the same `key:: value` form, but inside a block) →
 *     `properties` map on the block
 *   - Inline emphasis: `**bold**`, `*italic*` (or `_italic_`), `~~strike~~`,
 *     `==highlight==`, `` `code` ``
 *   - Wiki links: `[[Page Name]]` → markDef link with `logseq://page/<name>`
 *   - Standard MD links: `[text](url)` → markDef link
 *   - `#tag` and `((block-id))` references are preserved as plain text
 *
 * Multi-line block content (sub-paragraphs, headings inside a block, code
 * blocks) is deliberately out of scope for the initial cut — the body of each
 * outline block is treated as a single line of inline content.
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
  { delim: '__', decorator: 'em' },
  { delim: '~~', decorator: 'strike-through' },
  { delim: '==', decorator: 'highlight' },
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
    // [[Page Name]] wiki link
    if (input.startsWith('[[', i)) {
      const end = input.indexOf(']]', i + 2);
      if (end !== -1) {
        const inside = input.slice(i + 2, end);
        const pipe = inside.indexOf('|');
        const target = (pipe === -1 ? inside : inside.slice(0, pipe)).trim();
        const label = pipe === -1 ? target : inside.slice(pipe + 1).trim();
        flushBuf();
        tokens.push({
          text: label,
          decorators: [...stack],
          link: `logseq://page/${target}`,
        });
        i = end + 2;
        continue;
      }
    }
    // [text](url) standard markdown link
    if (input[i] === '[') {
      const close = input.indexOf(']', i + 1);
      if (close !== -1 && input[close + 1] === '(') {
        const urlEnd = input.indexOf(')', close + 2);
        if (urlEnd !== -1) {
          const label = input.slice(i + 1, close);
          const url = input.slice(close + 2, urlEnd);
          flushBuf();
          const innerTokens = parseInline(label);
          for (const t of innerTokens) {
            tokens.push({
              text: t.text,
              decorators: [...stack, ...t.decorators],
              link: t.link ?? url,
            });
          }
          i = urlEnd + 1;
          continue;
        }
      }
    }
    // `code` inline
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1);
      if (end !== -1) {
        flushBuf();
        tokens.push({ text: input.slice(i + 1, end), decorators: [...stack, 'code'] });
        i = end + 1;
        continue;
      }
    }
    // Multi-char decorator pairs.
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
    // *italic* — single asterisk, not part of `**`.
    if (
      input[i] === '*'
      && input[i + 1] !== '*'
      && input[i + 1] !== ' '
      && input[i + 1] !== undefined
    ) {
      const end = findUnpairedStar(input, i + 1);
      if (end !== -1 && input[end - 1] !== ' ') {
        flushBuf();
        const innerTokens = parseInline(input.slice(i + 1, end));
        for (const t of innerTokens) {
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

function findUnpairedStar(input: string, start: number): number {
  let i = start;
  while (i < input.length) {
    if (input[i] === '*') {
      if (input[i + 1] === '*') {
        i += 2;
        continue;
      }
      return i;
    }
    i += 1;
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

// --- Outline parser -------------------------------------------------------

const PROPERTY_RE = /^([a-zA-Z][\w-]*)\s*::\s*(.+)\s*$/;
// Block leader: any whitespace, then `- ` and the body.
const BLOCK_RE = /^(\s*)-\s+(.*)$/;

interface OutlineBlock {
  level: number; // 1-based outline depth
  text: string; // The block's primary content line (without `- `)
  properties: Record<string, string>;
}

function parseOutline(input: string): { pageProps: Record<string, string>, blocks: OutlineBlock[] } {
  const lines = input.split(/\r?\n/);
  const pageProps: Record<string, string> = {};
  let cursor = 0;
  // Page properties: leading `key:: value` lines until the first blank line
  // or first `- ` block.
  while (cursor < lines.length) {
    const line = lines[cursor]!;
    if (line.trim() === '') {
      cursor += 1;
      continue;
    }
    if (BLOCK_RE.test(line)) break;
    const m = PROPERTY_RE.exec(line);
    if (m) {
      pageProps[m[1]!] = m[2]!;
      cursor += 1;
      continue;
    }
    break;
  }

  const blocks: OutlineBlock[] = [];
  while (cursor < lines.length) {
    const line = lines[cursor]!;
    if (line.trim() === '') {
      cursor += 1;
      continue;
    }
    const m = BLOCK_RE.exec(line);
    if (!m) {
      cursor += 1;
      continue;
    }
    const indent = m[1]!.length;
    const level = Math.floor(indent / 2) + 1; // 2-space indent → +1 level
    const text = m[2]!;
    cursor += 1;
    // Consume any property lines that belong to this block (continuation
    // lines indented deeper than the block leader and matching `key:: value`).
    const properties: Record<string, string> = {};
    while (cursor < lines.length) {
      const next = lines[cursor]!;
      if (next.trim() === '') break;
      if (BLOCK_RE.test(next)) break;
      const pm = PROPERTY_RE.exec(next.trim());
      if (!pm) break;
      properties[pm[1]!] = pm[2]!;
      cursor += 1;
    }
    blocks.push({ level, text, properties });
  }

  return { pageProps, blocks };
}

export function logseqToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const { pageProps, blocks } = parseOutline(input);
  if (Object.keys(pageProps).length > 0) {
    out.push({
      _type: 'logseq:page-properties',
      _key: keys.block(),
      properties: pageProps,
    } as unknown as PortableTextBlock);
  }
  for (const ob of blocks) {
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = tokensToSpans(parseInline(ob.text), markDefs, keys);
    const block: PortableTextBlock = {
      _type: 'block',
      _key: keys.block(),
      style: 'normal',
      markDefs,
      children: children.length ? children : [{ _type: 'span', _key: keys.span(), text: '', marks: [] }],
    };
    (block as PortableTextBlock & { listItem: string, level: number }).listItem = 'bullet';
    (block as PortableTextBlock & { listItem: string, level: number }).level = ob.level;
    if (Object.keys(ob.properties).length > 0) {
      (block as PortableTextBlock & { properties: Record<string, string> }).properties = ob.properties;
    }
    out.push(block);
  }
  return out;
}

// --- PT -> Logseq ---------------------------------------------------------

const DECORATOR_WRAP: Record<string, [string, string]> = {
  strong: ['**', '**'],
  em: ['*', '*'],
  'strike-through': ['~~', '~~'],
  highlight: ['==', '=='],
  code: ['`', '`'],
};

function spanToLogseq(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
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
    if (href.startsWith('logseq://page/')) {
      const name = href.slice('logseq://page/'.length);
      text = text === name ? `[[${name}]]` : `[[${name}|${text}]]`;
    } else {
      text = `[${text}](${href})`;
    }
  }
  return text;
}

export function portableTextToLogseq(doc: PortableTextDocument): string {
  const out: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'logseq:page-properties') {
      const props = ((block as { properties?: unknown }).properties ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(props)) out.push(`${k}:: ${v}`);
      out.push(''); // blank line separates page props from outline
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    if (b.listItem !== 'bullet') continue;
    const level = Math.max(1, b.level ?? 1);
    const indent = '  '.repeat(level - 1);
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToLogseq(s, markDefs)).join('');
    out.push(`${indent}- ${text}`);
    const props = ((b as PortableTextBlock & { properties?: Record<string, string> }).properties ?? {}) as Record<
      string,
      string
    >;
    for (const [k, v] of Object.entries(props)) out.push(`${indent}  ${k}:: ${v}`);
  }
  return out.join('\n');
}

// --- Format ---------------------------------------------------------------

export const logseqFormat: Format = {
  id: 'logseq',
  label: 'Logseq',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return logseqToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToLogseq(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/^\s*-\s\S/m.test(value)) hits += 1;
    if (/^[a-zA-Z][\w-]*::\s/m.test(value)) hits += 2; // property line
    if (/\[\[[^\]\n]+\]\]/.test(value)) hits += 1; // wiki link
    if (/==[^=\n]+==/.test(value)) hits += 1; // highlight
    if (/\(\([0-9a-f-]+\)\)/.test(value)) hits += 2; // block ref
    return Math.min(1, hits * 0.22);
  },
};

export default logseqFormat;
