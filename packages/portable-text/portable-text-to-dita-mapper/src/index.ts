import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * DITA (Darwin Information Typing Architecture) XML <-> Portable Text.
 *
 * DITA is the OASIS-standardised topic-oriented schema for technical writing.
 * We parse the structural subset that maps onto Portable Text:
 *
 *   - `<topic>` (or `<concept>`, `<task>`, `<reference>`) → root container
 *   - `<title>` (depth 1) inside a topic → block style `h1`
 *   - `<section><title>` → block style at `h{1 + section nesting}`
 *   - `<p>` → block style `normal`
 *   - `<codeblock>` → `code` block (with optional `outputclass` as language)
 *   - `<ul>` / `<ol>` of `<li>` → list blocks (bullet / number)
 *   - `<note type="X">` → custom block `dita:note` with `noteType`
 *   - `<image>` → `image` block (`href` and `alt`)
 *
 * Inline mapping:
 *
 *   - `<b>`     → `strong`
 *   - `<i>`     → `em`
 *   - `<u>`     → `underline`
 *   - `<sub>` / `<sup>`
 *   - `<codeph>` / `<tt>` → `code`
 *   - `<xref href="…">` → `markDefs[link]`
 *   - `<keyword>` is flattened to plain text
 *
 * Tables (`<table>`, `<simpletable>`) and the broader DITA topic-type
 * specialisations are intentionally out of scope.
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

// --- XML tokeniser (shared shape with the FB2 format) --------------------

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
        // DOCTYPE / CDATA — strip up to the next `>`.
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

// --- DITA -> PT -----------------------------------------------------------

const INLINE_TO_DECORATOR: Record<string, string> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  u: 'underline',
  sub: 'sub',
  sup: 'sup',
  codeph: 'code',
  tt: 'code',
};

const TOPIC_ROOTS = new Set(['topic', 'concept', 'task', 'reference', 'glossentry']);

interface ParserState {
  tokens: Token[];
  pos: number;
  keys: Keys;
  out: PortableTextDocument;
  sectionDepth: number; // 0 = inside the topic root's body
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
      if (tok.name === 'xref') {
        const href = tok.attrs.href ?? '';
        const key = s.keys.mark();
        markDefs.push({ _type: 'link', _key: key, href });
        if (tok.selfClosing) continue;
        out.push(...collectInline(s, 'xref', markDefs, [...inheritedMarks, key]));
        continue;
      }
      if (tok.name === 'keyword' || tok.name === 'ph') {
        // Flatten to inherited marks.
        if (tok.selfClosing) continue;
        out.push(...collectInline(s, tok.name, markDefs, inheritedMarks));
        continue;
      }
      // Unknown inline element — flatten its body.
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

function handleList(s: ParserState, name: 'ul' | 'ol'): void {
  const listItem = name === 'ol' ? 'number' : 'bullet';
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === name) {
      s.pos += 1;
      return;
    }
    if (tok.kind === 'open' && tok.name === 'li') {
      s.pos += 1;
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(s, 'li', markDefs);
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

function handleNote(s: ParserState, attrs: Record<string, string>): void {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children: PortableTextSpan[] = [];
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'note') {
      s.pos += 1;
      break;
    }
    if (tok.kind === 'open' && tok.name === 'p') {
      s.pos += 1;
      children.push(...collectInline(s, 'p', markDefs));
      children.push({ _type: 'span', _key: s.keys.span(), text: '\n', marks: [] });
      continue;
    }
    if (tok.kind === 'text') {
      if (tok.text.length) children.push({ _type: 'span', _key: s.keys.span(), text: tok.text, marks: [] });
      s.pos += 1;
      continue;
    }
    s.pos += 1;
  }
  // Trim trailing synthesised newline.
  while (children.length && children[children.length - 1]?.text === '\n') children.pop();
  s.out.push({
    _type: 'dita:note',
    _key: s.keys.block(),
    noteType: attrs.type ?? 'note',
    markDefs,
    children: children.length ? children : [{ _type: 'span', _key: s.keys.span(), text: '', marks: [] }],
  } as unknown as PortableTextBlock);
}

function handleCodeBlock(s: ParserState, attrs: Record<string, string>): void {
  const parts: string[] = [];
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos++]!;
    if (tok.kind === 'close' && tok.name === 'codeblock') break;
    if (tok.kind === 'text') parts.push(tok.text);
  }
  s.out.push({
    _type: 'code',
    _key: s.keys.block(),
    code: parts.join('').replace(/^\n+|\n+$/g, ''),
    language: attrs.outputclass || attrs['xml:lang'] || null,
  } as unknown as PortableTextBlock);
}

function handleSection(s: ParserState): void {
  s.sectionDepth = Math.min(5, s.sectionDepth + 1);
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'section') {
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
    if (name === 'ul' || name === 'ol') {
      handleList(s, name);
      return;
    }
    if (name === 'codeblock') {
      handleCodeBlock(s, tok.attrs);
      return;
    }
    if (name === 'note') {
      handleNote(s, tok.attrs);
      return;
    }
    if (name === 'image') {
      if (!tok.selfClosing) skipUntilClose(s, 'image');
      s.out.push({
        _type: 'image',
        _key: s.keys.block(),
        url: tok.attrs.href ?? '',
        alt: tok.attrs.alt ?? '',
      } as unknown as PortableTextBlock);
      return;
    }
    if (name === 'section') {
      handleSection(s);
      return;
    }
    if (name === 'body' || name === 'conbody' || name === 'taskbody' || name === 'refbody') {
      // Transparent container — its children are siblings.
      return;
    }
    // Unknown element — skip subtree.
    if (!tok.selfClosing) skipUntilClose(s, name);
    return;
  }
  s.pos += 1;
}

export function ditaToPortableText(input: string): PortableTextDocument {
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
      if (TOPIC_ROOTS.has(tok.name)) {
        state.pos += 1;
        continue;
      }
      handleBodyToken(state, tok);
      continue;
    }
    state.pos += 1;
  }
  return state.out;
}

// --- PT -> DITA -----------------------------------------------------------

const DECORATOR_TO_TAG: Record<string, string> = {
  strong: 'b',
  em: 'i',
  underline: 'u',
  sub: 'sub',
  sup: 'sup',
  code: 'codeph',
};

function spanToDita(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
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
    text = `<xref href="${escapeXml(href)}">${text}</xref>`;
  }
  return text;
}

export function portableTextToDita(doc: PortableTextDocument): string {
  const inner: string[] = [];
  // Group consecutive list-item blocks under a single `<ul>` / `<ol>`.
  let listTag: 'ul' | 'ol' | null = null;
  const flushList = (): void => {
    if (listTag) inner.push(`</${listTag}>`);
    listTag = null;
  };
  const ensureList = (want: 'ul' | 'ol'): void => {
    if (listTag !== want) {
      flushList();
      listTag = want;
      inner.push(`<${want}>`);
    }
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'code') {
      flushList();
      const code = String((block as { code?: unknown }).code ?? '');
      const language = (block as { language?: unknown }).language;
      const attr = typeof language === 'string' && language ? ` outputclass="${escapeXml(language)}"` : '';
      inner.push(`<codeblock${attr}>${escapeXml(code)}</codeblock>`);
      continue;
    }
    if (t === 'image') {
      flushList();
      const url = escapeXml(String((block as { url?: unknown }).url ?? ''));
      const alt = escapeXml(String((block as { alt?: unknown }).alt ?? ''));
      inner.push(`<image href="${url}" alt="${alt}"/>`);
      continue;
    }
    if (t === 'dita:note') {
      flushList();
      const noteType = String((block as { noteType?: unknown }).noteType ?? 'note');
      const children = (block as { children?: PortableTextSpan[] }).children ?? [];
      const markDefs = ((block as { markDefs?: unknown }).markDefs ?? []) as PortableTextMarkDefinition[];
      const text = children.map(s => spanToDita(s, markDefs)).join('');
      inner.push(`<note type="${escapeXml(noteType)}"><p>${text}</p></note>`);
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToDita(s, markDefs)).join('');
    if (b.listItem === 'bullet') {
      ensureList('ul');
      inner.push(`<li>${text}</li>`);
      continue;
    }
    if (b.listItem === 'number') {
      ensureList('ol');
      inner.push(`<li>${text}</li>`);
      continue;
    }
    flushList();
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      inner.push(`<title>${text}</title>`);
    } else {
      inner.push(`<p>${text}</p>`);
    }
  }
  flushList();
  return `<?xml version="1.0" encoding="utf-8"?>\n<topic id="t1">\n<body>\n${inner.join('\n')}\n</body>\n</topic>`;
}

// --- Format ---------------------------------------------------------------

export const ditaFormat: Format = {
  id: 'dita',
  label: 'DITA XML',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return ditaToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToDita(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<topic\b/.test(value)) hits += 2;
    if (/<concept\b|<task\b|<reference\b/.test(value)) hits += 2;
    if (/<codeblock\b/.test(value)) hits += 2;
    if (/<xref\b/.test(value)) hits += 1;
    if (/<note\s+type=/.test(value)) hits += 1;
    return Math.min(1, hits * 0.22);
  },
};

export default ditaFormat;
