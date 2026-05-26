import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * WordPress Gutenberg blocks <-> Portable Text.
 *
 * Gutenberg posts mix HTML with block-delimiter comments:
 *
 *     <!-- wp:paragraph -->
 *     <p>Body text with <strong>bold</strong>.</p>
 *     <!-- /wp:paragraph -->
 *
 *     <!-- wp:heading {"level":2} -->
 *     <h2>Heading</h2>
 *     <!-- /wp:heading -->
 *
 *     <!-- wp:list {"ordered":true} -->
 *     <ol><li>one</li><li>two</li></ol>
 *     <!-- /wp:list -->
 *
 *     <!-- wp:code -->
 *     <pre class="wp-block-code"><code>x = 1</code></pre>
 *     <!-- /wp:code -->
 *
 *     <!-- wp:separator -->
 *     <hr class="wp-block-separator"/>
 *     <!-- /wp:separator -->
 *
 *     <!-- wp:quote -->
 *     <blockquote class="wp-block-quote"><p>said</p></blockquote>
 *     <!-- /wp:quote -->
 *
 * Block attributes are JSON between the type name and `-->` (`{"level":2}`).
 *
 * Inline mapping uses the HTML inside the block:
 *
 *   - `<strong>`/`<b>`, `<em>`/`<i>`, `<u>`, `<s>`/`<del>`/`<strike>`,
 *     `<sub>`/`<sup>`, `<code>` → corresponding decorators
 *   - `<a href="…">`                    → `markDefs[link]`
 *
 * Unknown `wp:*` blocks are preserved as `gutenberg:raw` custom blocks
 * carrying their raw HTML body and JSON attrs, so any third-party block
 * round-trips losslessly even if we don't model its semantics.
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

// --- HTML tokeniser -------------------------------------------------------

type Token =
  | { kind: 'open', name: string, attrs: Record<string, string>, selfClosing: boolean }
  | { kind: 'close', name: string }
  | { kind: 'text', text: string };

function tokeniseHtml(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    if (src[i] === '<') {
      const end = src.indexOf('>', i + 1);
      if (end === -1) {
        i = len;
        continue;
      }
      if (src[i + 1] === '/') {
        out.push({ kind: 'close', name: src.slice(i + 2, end).trim().toLowerCase() });
        i = end + 1;
        continue;
      }
      const inside = src.slice(i + 1, end).trim();
      const selfClosing = inside.endsWith('/');
      const cleaned = selfClosing ? inside.slice(0, -1).trim() : inside;
      const spaceAt = cleaned.search(/\s/);
      const rawName = spaceAt === -1 ? cleaned : cleaned.slice(0, spaceAt);
      const attrs = spaceAt === -1 ? {} : parseAttrs(cleaned.slice(spaceAt + 1));
      out.push({ kind: 'open', name: rawName.toLowerCase(), attrs, selfClosing });
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

function parseAttrs(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z][\w.:-]*)\s*=\s*"([^"]*)"|([A-Za-z][\w.:-]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const key = (m[1] ?? m[3] ?? '').toLowerCase();
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
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// --- Inline parser (subset of HTML) --------------------------------------

const INLINE_TO_DECORATOR: Record<string, string> = {
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  u: 'underline',
  s: 'strike-through',
  del: 'strike-through',
  strike: 'strike-through',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

function collectInline(
  tokens: Token[],
  start: number,
  closeName: string | null,
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
  inheritedMarks: string[] = [],
): { spans: PortableTextSpan[], next: number } {
  const spans: PortableTextSpan[] = [];
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.kind === 'close' && tok.name === closeName) return { spans, next: i + 1 };
    if (tok.kind === 'text') {
      if (tok.text.length) {
        spans.push({ _type: 'span', _key: keys.span(), text: tok.text, marks: inheritedMarks });
      }
      i += 1;
      continue;
    }
    if (tok.kind === 'open') {
      const decorator = INLINE_TO_DECORATOR[tok.name];
      if (decorator) {
        if (tok.selfClosing) {
          i += 1;
          continue;
        }
        const inner = collectInline(tokens, i + 1, tok.name, markDefs, keys, [...inheritedMarks, decorator]);
        spans.push(...inner.spans);
        i = inner.next;
        continue;
      }
      if (tok.name === 'a') {
        const href = tok.attrs.href ?? '';
        const key = keys.mark();
        markDefs.push({ _type: 'link', _key: key, href });
        if (tok.selfClosing) {
          i += 1;
          continue;
        }
        const inner = collectInline(tokens, i + 1, 'a', markDefs, keys, [...inheritedMarks, key]);
        spans.push(...inner.spans);
        i = inner.next;
        continue;
      }
      if (tok.name === 'br') {
        spans.push({ _type: 'span', _key: keys.span(), text: '\n', marks: inheritedMarks });
        i = tok.selfClosing ? i + 1 : i + 1;
        continue;
      }
      // Unknown inline element: flatten body.
      if (tok.selfClosing) {
        i += 1;
        continue;
      }
      const inner = collectInline(tokens, i + 1, tok.name, markDefs, keys, inheritedMarks);
      spans.push(...inner.spans);
      i = inner.next;
      continue;
    }
    i += 1;
  }
  return { spans, next: i };
}

// --- Gutenberg block parsing ---------------------------------------------

interface RawBlock {
  type: string;
  attrs: Record<string, unknown>;
  innerHTML: string;
}

const BLOCK_RE = /<!--\s*wp:([a-z][\w/-]*)\s*(\{[^]*?\})?\s*-->([\s\S]*?)<!--\s*\/wp:\1\s*-->/g;
const SELF_CLOSING_BLOCK_RE = /<!--\s*wp:([a-z][\w/-]*)\s*(\{[^]*?\})?\s*\/-->/g;

function parseRawBlocks(input: string): RawBlock[] {
  const out: RawBlock[] = [];
  // Self-closing blocks first: `<!-- wp:name {...} /-->`.
  const selfClosed = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = SELF_CLOSING_BLOCK_RE.exec(input)) !== null) {
    selfClosed.add(`${m.index}:${m[0].length}`);
    const attrs = parseJsonAttrs(m[2] ?? null);
    out.push({ type: m[1]!, attrs, innerHTML: '' });
  }
  // Paired blocks.
  while ((m = BLOCK_RE.exec(input)) !== null) {
    const attrs = parseJsonAttrs(m[2] ?? null);
    out.push({ type: m[1]!, attrs, innerHTML: m[3]!.trim() });
  }
  return out;
}

function parseJsonAttrs(input: string | null): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed: unknown = JSON.parse(input);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function spansFromHtml(
  html: string,
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
): PortableTextSpan[] {
  const tokens = tokeniseHtml(html);
  return collectInline(tokens, 0, null, markDefs, keys).spans;
}

function extractInlineFromTagSubset(
  html: string,
  tagName: string,
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
): PortableTextSpan[] {
  // Find the first `<tag>...</tag>` and return inline spans from its body.
  const tokens = tokeniseHtml(html);
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.kind === 'open' && tok.name === tagName) {
      return collectInline(tokens, i + 1, tagName, markDefs, keys).spans;
    }
  }
  return [];
}

function extractListItems(
  html: string,
  keys: Keys,
  listItem: 'bullet' | 'number',
): PortableTextBlock[] {
  const tokens = tokeniseHtml(html);
  const out: PortableTextBlock[] = [];
  // Walk for `<li>...</li>` pairs at any depth.
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    if (tok.kind === 'open' && tok.name === 'li') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const inner = collectInline(tokens, i + 1, 'li', markDefs, keys);
      const block: PortableTextBlock = {
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs,
        children: inner.spans.length
          ? inner.spans
          : [{ _type: 'span', _key: keys.span(), text: '', marks: [] }],
      };
      (block as PortableTextBlock & { listItem: string, level: number }).listItem = listItem;
      (block as PortableTextBlock & { listItem: string, level: number }).level = 1;
      out.push(block);
      i = inner.next - 1;
    }
  }
  return out;
}

export function gutenbergToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const blocks = parseRawBlocks(input);
  for (const raw of blocks) {
    switch (raw.type) {
      case 'paragraph': {
        const markDefs: PortableTextMarkDefinition[] = [];
        const children = extractInlineFromTagSubset(raw.innerHTML, 'p', markDefs, keys);
        out.push({
          _type: 'block',
          _key: keys.block(),
          style: 'normal',
          markDefs,
          children: children.length
            ? children
            : [{ _type: 'span', _key: keys.span(), text: '', marks: [] }],
        } as PortableTextBlock);
        continue;
      }
      case 'heading': {
        const level = typeof raw.attrs.level === 'number' ? Math.max(1, Math.min(6, raw.attrs.level)) : 2;
        const markDefs: PortableTextMarkDefinition[] = [];
        const children = extractInlineFromTagSubset(raw.innerHTML, `h${level}`, markDefs, keys);
        out.push({
          _type: 'block',
          _key: keys.block(),
          style: `h${level}`,
          markDefs,
          children,
        } as PortableTextBlock);
        continue;
      }
      case 'list': {
        const ordered = raw.attrs.ordered === true;
        const items = extractListItems(raw.innerHTML, keys, ordered ? 'number' : 'bullet');
        out.push(...items);
        continue;
      }
      case 'quote': {
        const markDefs: PortableTextMarkDefinition[] = [];
        const children = extractInlineFromTagSubset(raw.innerHTML, 'p', markDefs, keys);
        out.push({
          _type: 'block',
          _key: keys.block(),
          style: 'blockquote',
          markDefs,
          children,
        } as PortableTextBlock);
        continue;
      }
      case 'code': {
        const markDefs: PortableTextMarkDefinition[] = [];
        const codeSpans = extractInlineFromTagSubset(raw.innerHTML, 'code', markDefs, keys);
        const codeText = codeSpans.map(s => s.text).join('');
        out.push({
          _type: 'code',
          _key: keys.block(),
          code: codeText,
          language: typeof raw.attrs.language === 'string' ? raw.attrs.language : null,
        } as unknown as PortableTextBlock);
        continue;
      }
      case 'separator':
      case 'spacer':
        out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
        continue;
      case 'image': {
        const url = typeof raw.attrs.url === 'string'
          ? raw.attrs.url
          : extractImageSrc(raw.innerHTML);
        const alt = typeof raw.attrs.alt === 'string'
          ? raw.attrs.alt
          : extractImageAlt(raw.innerHTML);
        out.push({
          _type: 'image',
          _key: keys.block(),
          url,
          alt,
        } as unknown as PortableTextBlock);
        continue;
      }
      default:
        // Unknown block: preserve verbatim so round-trip is lossless.
        out.push({
          _type: 'gutenberg:raw',
          _key: keys.block(),
          blockType: raw.type,
          attrs: raw.attrs,
          html: raw.innerHTML,
        } as unknown as PortableTextBlock);
    }
  }
  return out;
}

function extractImageSrc(html: string): string {
  const m = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  return m ? decodeEntities(m[1]!) : '';
}
function extractImageAlt(html: string): string {
  const m = /<img\b[^>]*\balt\s*=\s*["']([^"']*)["']/i.exec(html);
  return m ? decodeEntities(m[1]!) : '';
}

// --- PT -> Gutenberg ------------------------------------------------------

const DECORATOR_TO_TAG: Record<string, string> = {
  strong: 'strong',
  em: 'em',
  underline: 'u',
  'strike-through': 's',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

function spanToHtml(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
  let text = escapeHtml(span.text);
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  for (const mark of marks) {
    if (mark === linkKey) continue;
    const tag = DECORATOR_TO_TAG[mark];
    if (tag) text = `<${tag}>${text}</${tag}>`;
  }
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    text = `<a href="${escapeHtml(href)}">${text}</a>`;
  }
  return text;
}

function spansToHtml(spans: PortableTextSpan[], markDefs: PortableTextMarkDefinition[]): string {
  return spans.map(s => spanToHtml(s, markDefs)).join('');
}

function attrsString(attrs: Record<string, unknown>): string {
  const keys = Object.keys(attrs);
  if (keys.length === 0) return '';
  return ` ${JSON.stringify(attrs)}`;
}

export function portableTextToGutenberg(doc: PortableTextDocument): string {
  const out: string[] = [];
  let listBuffer: { ordered: boolean, items: string[] } | null = null;
  const flushList = (): void => {
    if (!listBuffer) return;
    const tag = listBuffer.ordered ? 'ol' : 'ul';
    const attrs = listBuffer.ordered ? '{"ordered":true}' : '';
    const wrap = attrs ? `<!-- wp:list ${attrs} -->` : '<!-- wp:list -->';
    out.push(`${wrap}\n<${tag}>${listBuffer.items.join('')}</${tag}>\n<!-- /wp:list -->`);
    listBuffer = null;
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      flushList();
      out.push('<!-- wp:separator -->\n<hr class="wp-block-separator"/>\n<!-- /wp:separator -->');
      continue;
    }
    if (t === 'image') {
      flushList();
      const url = String((block as { url?: unknown }).url ?? '');
      const alt = String((block as { alt?: unknown }).alt ?? '');
      out.push(
        `<!-- wp:image -->\n<figure class="wp-block-image"><img src="${escapeHtml(url)}" alt="${
          escapeHtml(alt)
        }"/></figure>\n<!-- /wp:image -->`,
      );
      continue;
    }
    if (t === 'code') {
      flushList();
      const code = String((block as { code?: unknown }).code ?? '');
      const language = (block as { language?: unknown }).language;
      const attrs = typeof language === 'string' && language ? ` {"language":"${language}"}` : '';
      out.push(
        `<!-- wp:code${attrs} -->\n<pre class="wp-block-code"><code>${
          escapeHtml(code)
        }</code></pre>\n<!-- /wp:code -->`,
      );
      continue;
    }
    if (t === 'gutenberg:raw') {
      flushList();
      const blockType = String((block as { blockType?: unknown }).blockType ?? 'raw');
      const attrs = (block as { attrs?: unknown }).attrs ?? {};
      const html = String((block as { html?: unknown }).html ?? '');
      const attrStr = attrsString(attrs as Record<string, unknown>);
      out.push(`<!-- wp:${blockType}${attrStr} -->\n${html}\n<!-- /wp:${blockType} -->`);
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const html = spansToHtml((b.children ?? []) as PortableTextSpan[], markDefs);
    if (b.listItem === 'bullet' || b.listItem === 'number') {
      const ordered = b.listItem === 'number';
      if (listBuffer && listBuffer.ordered !== ordered) flushList();
      if (!listBuffer) listBuffer = { ordered, items: [] };
      listBuffer.items.push(`<li>${html}</li>`);
      continue;
    }
    flushList();
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      const level = Number(headingMatch[1]);
      const attrs = level === 2 ? '' : ` {"level":${level}}`;
      out.push(
        `<!-- wp:heading${attrs} -->\n<h${level}>${html}</h${level}>\n<!-- /wp:heading -->`,
      );
      continue;
    }
    if (style === 'blockquote') {
      out.push(
        `<!-- wp:quote -->\n<blockquote class="wp-block-quote"><p>${html}</p></blockquote>\n<!-- /wp:quote -->`,
      );
      continue;
    }
    out.push(`<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`);
  }
  flushList();
  return out.join('\n\n');
}

// --- Format ---------------------------------------------------------------

export const gutenbergFormat: Format = {
  id: 'gutenberg',
  label: 'WordPress Gutenberg blocks',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return gutenbergToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToGutenberg(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<!--\s*wp:[a-z]/i.test(value)) hits += 3;
    if (/<!--\s*\/wp:[a-z]/i.test(value)) hits += 2;
    if (/class="wp-block-/i.test(value)) hits += 1;
    return Math.min(1, hits * 0.22);
  },
};

export default gutenbergFormat;
