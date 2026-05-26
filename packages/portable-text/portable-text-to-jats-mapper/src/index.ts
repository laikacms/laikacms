import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * JATS (Journal Article Tag Suite) XML <-> Portable Text.
 *
 * JATS is the NISO Z39.96 standard the National Library of Medicine and
 * PubMed Central use for scholarly article markup. We model the article-body
 * subset that maps onto Portable Text:
 *
 *   - `<article>` / `<front>` / `<article-meta>` / `<body>` wrappers — passed
 *     through transparently
 *   - `<title-group><article-title>` → block style `h1`
 *   - `<sec>` (nestable) → wraps siblings; `<title>` inside a `<sec>` becomes
 *     a heading at `h{1 + nesting}`
 *   - `<p>` → block style `normal`
 *   - `<list list-type="bullet|order">` of `<list-item>` → list blocks
 *   - `<code>` (block) → `code` block
 *   - `<disp-quote>` → block style `blockquote`
 *
 * Inline elements:
 *
 *   - `<bold>`              → `strong`
 *   - `<italic>`            → `em`
 *   - `<underline>`         → `underline`
 *   - `<strike>`            → `strike-through`
 *   - `<sub>` / `<sup>`     → `sub` / `sup`
 *   - `<monospace>`         → `code`
 *   - `<ext-link xlink:href="…">` and `<uri>` → `markDefs[link]`
 *
 * Tables, figures, math, and the bibliographic `<ref-list>` are intentionally
 * out of scope.
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

// --- Tiny XML token reader -----------------------------------------------

type Token =
  | { kind: 'open', name: string, attrs: Record<string, string>, selfClosing: boolean }
  | { kind: 'close', name: string }
  | { kind: 'text', text: string };

function tokenise(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    if (src[i] === '<') {
      if (src.startsWith('<?', i)) {
        const end = src.indexOf('?>', i + 2);
        i = end === -1 ? len : end + 2;
        continue;
      }
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4);
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (src.startsWith('<!', i)) {
        const end = src.indexOf('>', i + 2);
        i = end === -1 ? len : end + 1;
        continue;
      }
      if (src[i + 1] === '/') {
        const end = src.indexOf('>', i + 2);
        if (end === -1) {
          i = len;
          continue;
        }
        out.push({ kind: 'close', name: stripNs(src.slice(i + 2, end).trim()) });
        i = end + 1;
        continue;
      }
      const end = src.indexOf('>', i + 1);
      if (end === -1) {
        i = len;
        continue;
      }
      const inside = src.slice(i + 1, end).trim();
      const selfClosing = inside.endsWith('/');
      const cleaned = selfClosing ? inside.slice(0, -1).trim() : inside;
      const spaceAt = cleaned.search(/\s/);
      const rawName = spaceAt === -1 ? cleaned : cleaned.slice(0, spaceAt);
      const name = stripNs(rawName);
      const attrs = spaceAt === -1 ? {} : parseAttrs(cleaned.slice(spaceAt + 1));
      out.push({ kind: 'open', name, attrs, selfClosing });
      i = end + 1;
      continue;
    }
    const next = src.indexOf('<', i);
    const piece = next === -1 ? src.slice(i) : src.slice(i, next);
    if (piece.length) out.push({ kind: 'text', text: decodeEntities(piece) });
    i = next === -1 ? len : next;
  }
  return out;
}

function stripNs(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

function parseAttrs(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z][\w.:-]*)\s*=\s*"([^"]*)"|([A-Za-z][\w.:-]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const key = stripNs(m[1] ?? m[3] ?? '');
    out[key] = decodeEntities(m[2] ?? m[4] ?? '');
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// --- JATS -> PT -----------------------------------------------------------

const INLINE_TO_DECORATOR: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'underline',
  strike: 'strike-through',
  sub: 'sub',
  sup: 'sup',
  monospace: 'code',
};

interface ParserState {
  tokens: Token[];
  pos: number;
  keys: Keys;
  out: PortableTextDocument;
  sectionDepth: number; // 0 = inside <body>, increments per nested <sec>
}

function skipUntilClose(s: ParserState, name: string): void {
  let depth = 1;
  while (s.pos < s.tokens.length && depth > 0) {
    const tok = s.tokens[s.pos++]!;
    if (tok.kind === 'open' && tok.name === name && !tok.selfClosing) depth += 1;
    else if (tok.kind === 'close' && tok.name === name) depth -= 1;
  }
}

function collectInline(
  s: ParserState,
  closeName: string,
  markDefs: PortableTextMarkDefinition[],
  inheritedMarks: string[] = [],
): PortableTextSpan[] {
  const out: PortableTextSpan[] = [];
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === closeName) {
      s.pos += 1;
      return out;
    }
    if (tok.kind === 'text') {
      if (tok.text.length) {
        out.push({ _type: 'span', _key: s.keys.span(), text: tok.text, marks: inheritedMarks });
      }
      s.pos += 1;
      continue;
    }
    if (tok.kind === 'open') {
      s.pos += 1;
      const decorator = INLINE_TO_DECORATOR[tok.name];
      if (decorator) {
        if (tok.selfClosing) continue;
        out.push(...collectInline(s, tok.name, markDefs, [...inheritedMarks, decorator]));
        continue;
      }
      if (tok.name === 'ext-link' || tok.name === 'uri') {
        const href = tok.attrs.href ?? tok.attrs['xlink:href'] ?? '';
        const key = s.keys.mark();
        markDefs.push({ _type: 'link', _key: key, href });
        if (tok.selfClosing) continue;
        out.push(...collectInline(s, tok.name, markDefs, [...inheritedMarks, key]));
        continue;
      }
      // Unknown inline element — flatten.
      if (!tok.selfClosing) {
        out.push(...collectInline(s, tok.name, markDefs, inheritedMarks));
      }
      continue;
    }
    s.pos += 1;
  }
  return out;
}

function emitBlock(
  s: ParserState,
  style: string,
  markDefs: PortableTextMarkDefinition[],
  children: PortableTextSpan[],
): void {
  if (children.length === 0) children.push({ _type: 'span', _key: s.keys.span(), text: '', marks: [] });
  s.out.push({
    _type: 'block',
    _key: s.keys.block(),
    style,
    markDefs,
    children,
  } as PortableTextBlock);
}

function handleList(s: ParserState, attrs: Record<string, string>): void {
  const listItem = attrs['list-type'] === 'order' || attrs['list-type'] === 'ordered' ? 'number' : 'bullet';
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'list') {
      s.pos += 1;
      return;
    }
    if (tok.kind === 'open' && tok.name === 'list-item') {
      s.pos += 1;
      // The item may wrap content in a `<p>` or just hold inline content
      // directly. Collect spans whatever the shape.
      const markDefs: PortableTextMarkDefinition[] = [];
      const spans: PortableTextSpan[] = [];
      while (s.pos < s.tokens.length) {
        const t = s.tokens[s.pos]!;
        if (t.kind === 'close' && t.name === 'list-item') {
          s.pos += 1;
          break;
        }
        if (t.kind === 'open' && t.name === 'p') {
          s.pos += 1;
          spans.push(...collectInline(s, 'p', markDefs));
          continue;
        }
        if (t.kind === 'text') {
          if (t.text.length) spans.push({ _type: 'span', _key: s.keys.span(), text: t.text, marks: [] });
          s.pos += 1;
          continue;
        }
        s.pos += 1;
      }
      const block: PortableTextBlock = {
        _type: 'block',
        _key: s.keys.block(),
        style: 'normal',
        markDefs,
        children: spans.length ? spans : [{ _type: 'span', _key: s.keys.span(), text: '', marks: [] }],
      };
      (block as PortableTextBlock & { listItem: string, level: number }).listItem = listItem;
      (block as PortableTextBlock & { listItem: string, level: number }).level = 1;
      s.out.push(block);
      continue;
    }
    s.pos += 1;
  }
}

function handleDispQuote(s: ParserState): void {
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'disp-quote') {
      s.pos += 1;
      return;
    }
    if (tok.kind === 'open' && tok.name === 'p') {
      s.pos += 1;
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(s, 'p', markDefs);
      emitBlock(s, 'blockquote', markDefs, children);
      continue;
    }
    s.pos += 1;
  }
}

function handleCodeBlock(s: ParserState): void {
  const parts: string[] = [];
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos++]!;
    if (tok.kind === 'close' && tok.name === 'code') break;
    if (tok.kind === 'text') parts.push(tok.text);
  }
  s.out.push({
    _type: 'code',
    _key: s.keys.block(),
    code: parts.join('').replace(/^\n+|\n+$/g, ''),
    language: null,
  } as unknown as PortableTextBlock);
}

function handleSec(s: ParserState): void {
  s.sectionDepth = Math.min(5, s.sectionDepth + 1);
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'sec') {
      s.pos += 1;
      break;
    }
    handleBodyToken(s, tok);
  }
  s.sectionDepth -= 1;
}

function handleBodyToken(s: ParserState, tok: Token): void {
  if (tok.kind === 'open') {
    s.pos += 1;
    const name = tok.name;
    if (name === 'p') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(s, 'p', markDefs);
      emitBlock(s, 'normal', markDefs, children);
      return;
    }
    if (name === 'title') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(s, 'title', markDefs);
      const level = Math.max(1, s.sectionDepth + 1);
      emitBlock(s, `h${Math.min(6, level)}`, markDefs, children);
      return;
    }
    if (name === 'article-title') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(s, 'article-title', markDefs);
      emitBlock(s, 'h1', markDefs, children);
      return;
    }
    if (name === 'list') {
      handleList(s, tok.attrs);
      return;
    }
    if (name === 'code') {
      handleCodeBlock(s);
      return;
    }
    if (name === 'disp-quote') {
      handleDispQuote(s);
      return;
    }
    if (name === 'sec') {
      handleSec(s);
      return;
    }
    // Transparent containers — descend.
    if (
      name === 'body'
      || name === 'article'
      || name === 'front'
      || name === 'article-meta'
      || name === 'title-group'
      || name === 'abstract'
    ) {
      return;
    }
    // Unknown element — skip subtree.
    if (!tok.selfClosing) skipUntilClose(s, name);
    return;
  }
  s.pos += 1;
}

export function jatsToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const state: ParserState = {
    tokens: tokenise(input),
    pos: 0,
    keys,
    out: [],
    sectionDepth: 0,
  };
  while (state.pos < state.tokens.length) {
    const tok = state.tokens[state.pos]!;
    handleBodyToken(state, tok);
  }
  return state.out;
}

// --- PT -> JATS -----------------------------------------------------------

const DECORATOR_TO_TAG: Record<string, string> = {
  strong: 'bold',
  em: 'italic',
  underline: 'underline',
  'strike-through': 'strike',
  sub: 'sub',
  sup: 'sup',
  code: 'monospace',
};

function spanToJats(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = escapeXml(span.text);
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  for (const mark of marks) {
    if (mark === linkKey) continue;
    const tag = DECORATOR_TO_TAG[mark];
    if (tag) text = `<${tag}>${text}</${tag}>`;
  }
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    text = `<ext-link xlink:href="${escapeXml(href)}">${text}</ext-link>`;
  }
  return text;
}

export function portableTextToJats(doc: PortableTextDocument): string {
  const inner: string[] = [];
  let listTag: 'bullet' | 'order' | null = null;
  const flushList = (): void => {
    if (listTag) inner.push('</list>');
    listTag = null;
  };
  const ensureList = (want: 'bullet' | 'order'): void => {
    if (listTag !== want) {
      flushList();
      listTag = want;
      inner.push(`<list list-type="${want}">`);
    }
  };
  // Each `<sec>` corresponds to one level of heading depth: h2 sits inside one
  // `<sec>`, h3 inside two, etc. h1 is emitted bare (the parser treats a body-
  // level `<title>` as h1) so opening any sec means a previous heading was
  // h2 or deeper.
  let openSecs = 0;
  const closeSecsTo = (target: number): void => {
    while (openSecs > target) {
      inner.push('</sec>');
      openSecs -= 1;
    }
  };
  const openSecsTo = (target: number): void => {
    while (openSecs < target) {
      inner.push('<sec>');
      openSecs += 1;
    }
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'code') {
      flushList();
      const code = String((block as { code?: unknown }).code ?? '');
      inner.push(`<code>${escapeXml(code)}</code>`);
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToJats(s, markDefs)).join('');
    if (b.listItem === 'bullet') {
      ensureList('bullet');
      inner.push(`<list-item><p>${text}</p></list-item>`);
      continue;
    }
    if (b.listItem === 'number') {
      ensureList('order');
      inner.push(`<list-item><p>${text}</p></list-item>`);
      continue;
    }
    flushList();
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      const level = Number(headingMatch[1]);
      if (level === 1) {
        closeSecsTo(0);
        inner.push(`<title>${text}</title>`);
      } else {
        const parent = level - 2;
        closeSecsTo(parent);
        openSecsTo(parent);
        inner.push('<sec>');
        openSecs += 1;
        inner.push(`<title>${text}</title>`);
      }
      continue;
    }
    if (style === 'blockquote') {
      inner.push(`<disp-quote><p>${text}</p></disp-quote>`);
    } else {
      inner.push(`<p>${text}</p>`);
    }
  }
  flushList();
  closeSecsTo(0);
  return `<?xml version="1.0" encoding="utf-8"?>\n<article xmlns:xlink="http://www.w3.org/1999/xlink">\n<body>\n${
    inner.join('\n')
  }\n</body>\n</article>`;
}

// --- Format ---------------------------------------------------------------

export const jatsFormat: Format = {
  id: 'jats',
  label: 'JATS XML',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return jatsToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToJats(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<article\b/.test(value)) hits += 1;
    if (/<article-title\b/.test(value)) hits += 2;
    if (/<sec\b/.test(value) && /<title>/.test(value)) hits += 2;
    if (/<list\s+list-type=/.test(value)) hits += 2;
    if (/<ext-link\b/.test(value)) hits += 1;
    if (/xmlns:xlink/.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default jatsFormat;
