import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * FictionBook 2 (FB2) <-> Portable Text.
 *
 * FB2 is an XML-based ebook format. We parse a focused subset that maps onto
 * Portable Text:
 *
 *   - `<section>` nesting depth         → block heading level
 *   - `<title><p>…</p></title>`         → block style `h{depth}`
 *   - `<subtitle>…</subtitle>`          → block style `h{depth+1}`
 *   - `<p>…</p>`                        → block style `normal`
 *   - `<cite><p>…</p></cite>`           → block style `blockquote`
 *   - `<epigraph><p>…</p></epigraph>`   → block style `blockquote`
 *   - `<empty-line/>`                   → `hr` block
 *   - `<code>…</code>` (block, multi-line) → `code` block
 *
 * Inline elements:
 *
 *   - `<emphasis>`       → `em`
 *   - `<strong>`         → `strong`
 *   - `<strikethrough>`  → `strike-through`
 *   - `<sub>` / `<sup>`  → `sub` / `sup`
 *   - `<code>` (inline)  → `code`
 *   - `<a l:href="…">`   → `markDefs[link]`
 *
 * `<FictionBook>` / `<body>` wrappers are accepted but optional. Poems,
 * stanzas, tables, and binary image payloads are out of scope.
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
      // Strip processing instructions and comments.
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
      // Closing tag.
      if (src[i + 1] === '/') {
        const end = src.indexOf('>', i + 2);
        if (end === -1) {
          i = len;
          continue;
        }
        const name = stripNs(src.slice(i + 2, end).trim());
        out.push({ kind: 'close', name });
        i = end + 1;
        continue;
      }
      // Opening (or self-closing) tag.
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
    // Text run.
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
    const value = m[2] ?? m[4] ?? '';
    out[key] = decodeEntities(value);
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

// --- FB2 -> PT ------------------------------------------------------------

const INLINE_TO_DECORATOR: Record<string, string> = {
  emphasis: 'em',
  strong: 'strong',
  strikethrough: 'strike-through',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

interface ParserState {
  tokens: Token[];
  pos: number;
  keys: Keys;
  out: PortableTextDocument;
  sectionDepth: number;
}

function peek(s: ParserState): Token | undefined {
  return s.tokens[s.pos];
}
function consume(s: ParserState): Token | undefined {
  return s.tokens[s.pos++];
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
        out.push({
          _type: 'span',
          _key: s.keys.span(),
          text: tok.text,
          marks: inheritedMarks,
        });
      }
      s.pos += 1;
      continue;
    }
    if (tok.kind === 'open') {
      s.pos += 1;
      const decorator = INLINE_TO_DECORATOR[tok.name];
      if (decorator) {
        if (tok.selfClosing) continue;
        const nested = collectInline(s, tok.name, markDefs, [...inheritedMarks, decorator]);
        out.push(...nested);
        continue;
      }
      if (tok.name === 'a') {
        const href = tok.attrs.href ?? tok.attrs['l:href'] ?? '';
        const key = s.keys.mark();
        markDefs.push({ _type: 'link', _key: key, href });
        if (tok.selfClosing) continue;
        const nested = collectInline(s, 'a', markDefs, [...inheritedMarks, key]);
        out.push(...nested);
        continue;
      }
      // Unknown inline element — flatten by consuming until its close.
      if (!tok.selfClosing) skipUntilClose(s, tok.name);
      continue;
    }
    // Stray close — skip.
    s.pos += 1;
  }
  return out;
}

function skipUntilClose(s: ParserState, name: string): void {
  let depth = 1;
  while (s.pos < s.tokens.length && depth > 0) {
    const tok = s.tokens[s.pos]!;
    s.pos += 1;
    if (tok.kind === 'open' && tok.name === name && !tok.selfClosing) depth += 1;
    else if (tok.kind === 'close' && tok.name === name) depth -= 1;
  }
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

function handleParagraphLike(s: ParserState, openName: string, style: string): void {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = collectInline(s, openName, markDefs);
  emitBlock(s, style, markDefs, children);
}

function handleSection(s: ParserState): void {
  s.sectionDepth = Math.min(6, s.sectionDepth + 1);
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'section') {
      s.pos += 1;
      break;
    }
    if (tok.kind === 'open') {
      s.pos += 1;
      const name = tok.name;
      if (name === 'section') {
        handleSection(s);
        continue;
      }
      if (name === 'title') {
        // `<title>` contains 1..n `<p>`s; concatenate them as the heading text.
        const markDefs: PortableTextMarkDefinition[] = [];
        const children: PortableTextSpan[] = [];
        while (s.pos < s.tokens.length) {
          const t = s.tokens[s.pos]!;
          if (t.kind === 'close' && t.name === 'title') {
            s.pos += 1;
            break;
          }
          if (t.kind === 'open' && t.name === 'p') {
            s.pos += 1;
            children.push(...collectInline(s, 'p', markDefs));
            continue;
          }
          s.pos += 1;
        }
        emitBlock(s, `h${s.sectionDepth}`, markDefs, children);
        continue;
      }
      if (name === 'subtitle') {
        handleParagraphLike(s, 'subtitle', `h${Math.min(6, s.sectionDepth + 1)}`);
        continue;
      }
      if (name === 'p') {
        handleParagraphLike(s, 'p', 'normal');
        continue;
      }
      if (name === 'empty-line') {
        if (!tok.selfClosing) skipUntilClose(s, 'empty-line');
        s.out.push({ _type: 'hr', _key: s.keys.block() } as unknown as PortableTextBlock);
        continue;
      }
      if (name === 'cite' || name === 'epigraph') {
        while (s.pos < s.tokens.length) {
          const t = s.tokens[s.pos]!;
          if (t.kind === 'close' && t.name === name) {
            s.pos += 1;
            break;
          }
          if (t.kind === 'open' && t.name === 'p') {
            s.pos += 1;
            handleParagraphLike(s, 'p', 'blockquote');
            // handleParagraphLike already consumed up to and including the
            // matching </p>, with style overridden.
            // Override the style of the just-pushed block to `blockquote`:
            const last = s.out[s.out.length - 1] as PortableTextBlock;
            if (last && last._type === 'block') last.style = 'blockquote';
            continue;
          }
          s.pos += 1;
        }
        continue;
      }
      if (name === 'code') {
        // Block code: gather text until close.
        const parts: string[] = [];
        while (s.pos < s.tokens.length) {
          const t = s.tokens[s.pos]!;
          s.pos += 1;
          if (t.kind === 'close' && t.name === 'code') break;
          if (t.kind === 'text') parts.push(t.text);
        }
        s.out.push({
          _type: 'code',
          _key: s.keys.block(),
          code: parts.join(''),
          language: null,
        } as unknown as PortableTextBlock);
        continue;
      }
      // Unknown structural element — skip its subtree.
      if (!tok.selfClosing) skipUntilClose(s, name);
      continue;
    }
    s.pos += 1;
  }
  s.sectionDepth -= 1;
}

export function fb2ToPortableText(input: string): PortableTextDocument {
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
    if (tok.kind === 'open') {
      state.pos += 1;
      if (tok.name === 'FictionBook' || tok.name === 'body') continue;
      if (tok.name === 'section') {
        handleSection(state);
        continue;
      }
      if (tok.name === 'p') {
        handleParagraphLike(state, 'p', 'normal');
        continue;
      }
      if (tok.name === 'empty-line') {
        if (!tok.selfClosing) skipUntilClose(state, 'empty-line');
        state.out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
        continue;
      }
      // Skip unknown top-level elements.
      if (!tok.selfClosing) skipUntilClose(state, tok.name);
      continue;
    }
    state.pos += 1;
  }
  return state.out;
}

// --- PT -> FB2 ------------------------------------------------------------

const DECORATOR_TO_TAG: Record<string, string> = {
  em: 'emphasis',
  strong: 'strong',
  'strike-through': 'strikethrough',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

function spanToFb2(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
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
    text = `<a l:href="${escapeXml(href)}">${text}</a>`;
  }
  return text;
}

export function portableTextToFb2(doc: PortableTextDocument): string {
  const inner: string[] = [];
  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      inner.push('<empty-line/>');
      continue;
    }
    if (t === 'code') {
      const code = String((block as { code?: unknown }).code ?? '');
      inner.push(`<code>${escapeXml(code)}</code>`);
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[])
      .map(s => spanToFb2(s, markDefs))
      .join('');
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      inner.push(`<title><p>${text}</p></title>`);
    } else if (style === 'blockquote') {
      inner.push(`<cite><p>${text}</p></cite>`);
    } else {
      inner.push(`<p>${text}</p>`);
    }
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns:l="http://www.w3.org/1999/xlink">\n<body><section>\n${
    inner.join('\n')
  }\n</section></body>\n</FictionBook>`;
}

// --- Format ---------------------------------------------------------------

export const fb2Format: Format = {
  id: 'fb2',
  label: 'FictionBook 2 (FB2)',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return fb2ToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToFb2(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<FictionBook\b/.test(value)) hits += 3;
    if (/xmlns:l\s*=\s*"http:\/\/www\.w3\.org\/1999\/xlink"/.test(value)) hits += 2;
    if (/<section\b/.test(value) && /<p>/.test(value)) hits += 1;
    if (/<empty-line\s*\/>/.test(value)) hits += 1;
    if (/<emphasis>/.test(value) || /<strong>/.test(value)) hits += 1;
    return Math.min(1, hits * 0.2);
  },
};

export default fb2Format;
