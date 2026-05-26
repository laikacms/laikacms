import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * TEI XML (Text Encoding Initiative) <-> Portable Text.
 *
 * TEI is the long-standing scholarly markup used in digital humanities. We
 * model the body subset that maps cleanly onto Portable Text:
 *
 *   - `<TEI>` / `<text>` / `<body>` / `<front>` / `<back>` wrappers are
 *     passed through
 *   - `<div>` nesting drives heading depth: a `<head>` inside `n` enclosing
 *     `<div>` elements becomes `h{n}` (max 6)
 *   - `<p>` → block style `normal`
 *   - `<list type="ordered">` of `<item>` → numbered list blocks
 *   - any other `<list>` of `<item>` → bullet list blocks
 *   - `<quote>` → block style `blockquote` (single-`<p>` content folded into a
 *     single block)
 *   - `<code>` (block, multi-line) → `code` block
 *
 * Inline elements:
 *
 *   - `<hi rend="italic">`  → `em`
 *   - `<hi rend="bold">`    → `strong`
 *   - `<hi rend="underline">` → `underline`
 *   - `<hi rend="strikethrough">` → `strike-through`
 *   - `<hi rend="sub">` / `<hi rend="sup">` → `sub` / `sup`
 *   - `<code>` (inline)     → `code`
 *   - `<ref target="…">` and `<ptr target="…"/>` → `markDefs[link]`
 *
 * The TEI Header (`<teiHeader>`), tables, milestone tags, and the broader
 * critical-apparatus / linguistic-annotation tagsets are out of scope.
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

// --- TEI -> PT ------------------------------------------------------------

const REND_TO_DECORATOR: Record<string, string> = {
  italic: 'em',
  it: 'em',
  i: 'em',
  bold: 'strong',
  b: 'strong',
  underline: 'underline',
  u: 'underline',
  strikethrough: 'strike-through',
  strike: 'strike-through',
  s: 'strike-through',
  sup: 'sup',
  sub: 'sub',
};

const TEI_ROOTS = new Set(['TEI', 'tei', 'text', 'body', 'front', 'back']);

interface ParserState {
  tokens: Token[];
  pos: number;
  keys: Keys;
  out: PortableTextDocument;
  divDepth: number; // number of enclosing <div>
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
      if (tok.name === 'hi') {
        const rend = (tok.attrs.rend ?? tok.attrs.rendition ?? '').toLowerCase();
        const decorator = REND_TO_DECORATOR[rend] ?? null;
        if (tok.selfClosing) continue;
        out.push(...collectInline(s, 'hi', markDefs, decorator ? [...inheritedMarks, decorator] : inheritedMarks));
        continue;
      }
      if (tok.name === 'code') {
        // Inline `<code>` (when not the only child of a structural parent). We
        // treat it as a `code` decorator span; block code is handled at the
        // structural layer.
        if (tok.selfClosing) continue;
        out.push(...collectInline(s, 'code', markDefs, [...inheritedMarks, 'code']));
        continue;
      }
      if (tok.name === 'ref' || tok.name === 'ptr') {
        const href = tok.attrs.target ?? tok.attrs.href ?? '';
        const key = s.keys.mark();
        markDefs.push({ _type: 'link', _key: key, href });
        if (tok.selfClosing) continue;
        out.push(...collectInline(s, tok.name, markDefs, [...inheritedMarks, key]));
        continue;
      }
      // Unknown inline element — flatten body.
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
  const listItem = (attrs.type ?? '').toLowerCase() === 'ordered' ? 'number' : 'bullet';
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'list') {
      s.pos += 1;
      return;
    }
    if (tok.kind === 'open' && tok.name === 'item') {
      s.pos += 1;
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(s, 'item', markDefs);
      const block: PortableTextBlock = {
        _type: 'block',
        _key: s.keys.block(),
        style: 'normal',
        markDefs,
        children: children.length ? children : [{ _type: 'span', _key: s.keys.span(), text: '', marks: [] }],
      };
      (block as PortableTextBlock & { listItem: string, level: number }).listItem = listItem;
      (block as PortableTextBlock & { listItem: string, level: number }).level = 1;
      s.out.push(block);
      continue;
    }
    s.pos += 1;
  }
}

function handleCodeBlock(s: ParserState): void {
  // Collect text; child tags get flattened to their text content.
  const parts: string[] = [];
  let depth = 1;
  while (s.pos < s.tokens.length && depth > 0) {
    const tok = s.tokens[s.pos++]!;
    if (tok.kind === 'open' && tok.name === 'code' && !tok.selfClosing) depth += 1;
    else if (tok.kind === 'close' && tok.name === 'code') depth -= 1;
    else if (tok.kind === 'text') parts.push(tok.text);
  }
  s.out.push({
    _type: 'code',
    _key: s.keys.block(),
    code: parts.join('').replace(/^\n+|\n+$/g, ''),
    language: null,
  } as unknown as PortableTextBlock);
}

function handleQuote(s: ParserState): void {
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'quote') {
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
    if (tok.kind === 'text') {
      // Bare text in a quote — wrap in a blockquote block.
      if (tok.text.length) {
        emitBlock(s, 'blockquote', [], [{ _type: 'span', _key: s.keys.span(), text: tok.text, marks: [] }]);
      }
      s.pos += 1;
      continue;
    }
    s.pos += 1;
  }
}

function handleDiv(s: ParserState): void {
  s.divDepth = Math.min(6, s.divDepth + 1);
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'div') {
      s.pos += 1;
      break;
    }
    handleBodyToken(s, tok);
  }
  s.divDepth -= 1;
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
    if (name === 'head') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(s, 'head', markDefs);
      const level = Math.max(1, s.divDepth);
      emitBlock(s, `h${Math.min(6, level)}`, markDefs, children);
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
    if (name === 'quote') {
      handleQuote(s);
      return;
    }
    if (name === 'div') {
      handleDiv(s);
      return;
    }
    if (TEI_ROOTS.has(name) || name === 'teiHeader') {
      if (name === 'teiHeader') {
        if (!tok.selfClosing) skipUntilClose(s, 'teiHeader');
      }
      return;
    }
    if (!tok.selfClosing) skipUntilClose(s, name);
    return;
  }
  s.pos += 1;
}

export function teiToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const state: ParserState = {
    tokens: tokenise(input),
    pos: 0,
    keys,
    out: [],
    divDepth: 0,
  };
  while (state.pos < state.tokens.length) {
    const tok = state.tokens[state.pos]!;
    handleBodyToken(state, tok);
  }
  return state.out;
}

// --- PT -> TEI ------------------------------------------------------------

const DECORATOR_TO_REND: Record<string, string> = {
  strong: 'bold',
  em: 'italic',
  underline: 'underline',
  'strike-through': 'strikethrough',
  sub: 'sub',
  sup: 'sup',
};

function spanToTei(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = escapeXml(span.text);
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  for (const mark of marks) {
    if (mark === linkKey) continue;
    if (mark === 'code') {
      text = `<code>${text}</code>`;
      continue;
    }
    const rend = DECORATOR_TO_REND[mark];
    if (rend) text = `<hi rend="${rend}">${text}</hi>`;
  }
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    text = `<ref target="${escapeXml(href)}">${text}</ref>`;
  }
  return text;
}

export function portableTextToTei(doc: PortableTextDocument): string {
  const inner: string[] = [];
  let listTag: 'bullet' | 'ordered' | null = null;
  const flushList = (): void => {
    if (listTag) inner.push('</list>');
    listTag = null;
  };
  const ensureList = (want: 'bullet' | 'ordered'): void => {
    if (listTag !== want) {
      flushList();
      listTag = want;
      inner.push(want === 'ordered' ? `<list type="ordered">` : `<list>`);
    }
  };
  // Each open `<div>` nests one heading level. h1 sits inside one `<div>`,
  // h2 inside two, etc. (matches the parser's depth-driven `<head>` mapping).
  let openDivs = 0;
  const closeDivsTo = (target: number): void => {
    while (openDivs > target) {
      inner.push('</div>');
      openDivs -= 1;
    }
  };
  const openDivsTo = (target: number): void => {
    while (openDivs < target) {
      inner.push('<div>');
      openDivs += 1;
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
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToTei(s, markDefs)).join('');
    if (b.listItem === 'bullet') {
      ensureList('bullet');
      inner.push(`<item>${text}</item>`);
      continue;
    }
    if (b.listItem === 'number') {
      ensureList('ordered');
      inner.push(`<item>${text}</item>`);
      continue;
    }
    flushList();
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      const level = Number(headingMatch[1]);
      const parent = level - 1;
      closeDivsTo(parent);
      openDivsTo(parent);
      inner.push('<div>');
      openDivs += 1;
      inner.push(`<head>${text}</head>`);
      continue;
    }
    if (style === 'blockquote') {
      inner.push(`<quote><p>${text}</p></quote>`);
    } else {
      inner.push(`<p>${text}</p>`);
    }
  }
  flushList();
  closeDivsTo(0);
  return `<?xml version="1.0" encoding="utf-8"?>\n<TEI xmlns="http://www.tei-c.org/ns/1.0">\n<text>\n<body>\n${
    inner.join('\n')
  }\n</body>\n</text>\n</TEI>`;
}

// --- Format ---------------------------------------------------------------

export const teiFormat: Format = {
  id: 'tei',
  label: 'TEI XML',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return teiToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToTei(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<TEI\b/.test(value)) hits += 2;
    if (/www\.tei-c\.org/.test(value)) hits += 2;
    if (/<teiHeader\b/.test(value)) hits += 2;
    if (/<hi\s+rend=/.test(value)) hits += 1;
    if (/<head>/.test(value) && /<div\b/.test(value)) hits += 1;
    return Math.min(1, hits * 0.22);
  },
};

export default teiFormat;
