import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Confluence Storage Format (CSF) <-> Portable Text.
 *
 * CSF is Atlassian's XHTML-plus-macros format that Confluence persists pages
 * in. We model the constructs that have a clear Portable Text mapping:
 *
 *   HTML-shaped blocks:
 *     - `<h1>` … `<h6>`                → block style `h1`..`h6`
 *     - `<p>`                          → block style `normal`
 *     - `<blockquote>`                 → block style `blockquote`
 *     - `<ul>` / `<ol>` of `<li>`      → list blocks (bullet / number)
 *     - `<hr/>`                        → `hr` block
 *
 *   Macros (`<ac:structured-macro ac:name="…">`):
 *     - `code` (with `<ac:parameter ac:name="language">` + `<ac:plain-text-body>` CDATA) → `code` block
 *     - `info`, `note`, `tip`, `warning` → custom `confluence:macro` block with `macroName`
 *       and text body
 *
 *   Inline:
 *     - `<strong>`/`<b>`               → `strong`
 *     - `<em>`/`<i>`                   → `em`
 *     - `<u>`                          → `underline`
 *     - `<s>` / `<del>` / `<strike>`   → `strike-through`
 *     - `<sub>` / `<sup>`              → `sub` / `sup`
 *     - `<code>`                       → `code`
 *     - `<a href="…">`                 → `markDefs[link]`
 *     - `<ac:link><ri:page ri:content-title="…"/><ac:plain-text-link-body>…</ac:plain-text-link-body></ac:link>`
 *       → link with `confluence://page/<title>` href
 *
 * Tables, attachments, the rich set of macros beyond the four panels, and
 * legacy `<ac:layout>` wrappers are out of scope.
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

// --- XML tokeniser --------------------------------------------------------

type Token =
  | { kind: 'open', name: string, raw: string, attrs: Record<string, string>, selfClosing: boolean }
  | { kind: 'close', name: string, raw: string }
  | { kind: 'text', text: string }
  | { kind: 'cdata', text: string };

function tokenise(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    if (src[i] === '<') {
      if (src.startsWith('<![CDATA[', i)) {
        const end = src.indexOf(']]>', i + 9);
        if (end === -1) {
          i = len;
          continue;
        }
        out.push({ kind: 'cdata', text: src.slice(i + 9, end) });
        i = end + 3;
        continue;
      }
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
        const raw = src.slice(i + 2, end).trim();
        out.push({ kind: 'close', name: raw.toLowerCase(), raw });
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
      const attrs = spaceAt === -1 ? {} : parseAttrs(cleaned.slice(spaceAt + 1));
      out.push({ kind: 'open', name: rawName.toLowerCase(), raw: rawName, attrs, selfClosing });
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// --- CSF -> PT ------------------------------------------------------------

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

const PANEL_MACROS = new Set(['info', 'note', 'tip', 'warning']);

interface ParserState {
  tokens: Token[];
  pos: number;
  keys: Keys;
  out: PortableTextDocument;
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
    if (tok.kind === 'cdata') {
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
      if (tok.name === 'a') {
        const href = tok.attrs.href ?? '';
        const key = s.keys.mark();
        markDefs.push({ _type: 'link', _key: key, href });
        if (tok.selfClosing) continue;
        out.push(...collectInline(s, 'a', markDefs, [...inheritedMarks, key]));
        continue;
      }
      if (tok.name === 'ac:link') {
        const linkOut = handleAcLink(s, markDefs, inheritedMarks);
        out.push(...linkOut);
        continue;
      }
      if (tok.name === 'br') {
        out.push({ _type: 'span', _key: s.keys.span(), text: '\n', marks: inheritedMarks });
        if (!tok.selfClosing) skipUntilClose(s, 'br');
        continue;
      }
      // Unknown inline tag — flatten.
      if (!tok.selfClosing) {
        out.push(...collectInline(s, tok.name, markDefs, inheritedMarks));
      }
      continue;
    }
    s.pos += 1;
  }
  return out;
}

function handleAcLink(
  s: ParserState,
  markDefs: PortableTextMarkDefinition[],
  inheritedMarks: string[],
): PortableTextSpan[] {
  // Inside an ac:link we may see an `ri:page`, `ri:url`, or `ri:attachment`
  // followed by either `ac:plain-text-link-body` (CDATA text) or
  // `ac:link-body` (rich content).
  let href = '';
  let bodyText = '';
  let bodyMarks: string[] = [];
  while (s.pos < s.tokens.length) {
    const tok = s.tokens[s.pos]!;
    if (tok.kind === 'close' && tok.name === 'ac:link') {
      s.pos += 1;
      break;
    }
    if (tok.kind === 'open') {
      s.pos += 1;
      if (tok.name === 'ri:page') {
        const title = tok.attrs['ri:content-title'] ?? '';
        const space = tok.attrs['ri:space-key'] ?? '';
        href = space ? `confluence://page/${space}/${title}` : `confluence://page/${title}`;
        if (!tok.selfClosing) skipUntilClose(s, 'ri:page');
        continue;
      }
      if (tok.name === 'ri:url') {
        href = tok.attrs['ri:value'] ?? '';
        if (!tok.selfClosing) skipUntilClose(s, 'ri:url');
        continue;
      }
      if (tok.name === 'ri:attachment') {
        const fname = tok.attrs['ri:filename'] ?? '';
        href = `confluence://attachment/${fname}`;
        if (!tok.selfClosing) skipUntilClose(s, 'ri:attachment');
        continue;
      }
      if (tok.name === 'ac:plain-text-link-body') {
        // CDATA body holds the link text.
        while (s.pos < s.tokens.length) {
          const inner = s.tokens[s.pos]!;
          if (inner.kind === 'close' && inner.name === 'ac:plain-text-link-body') {
            s.pos += 1;
            break;
          }
          if (inner.kind === 'cdata') bodyText += inner.text;
          else if (inner.kind === 'text') bodyText += inner.text;
          s.pos += 1;
        }
        continue;
      }
      if (tok.name === 'ac:link-body') {
        const innerMarkDefs: PortableTextMarkDefinition[] = [];
        const innerSpans = collectInline(s, 'ac:link-body', innerMarkDefs, inheritedMarks);
        bodyText = innerSpans.map(c => c.text).join('');
        bodyMarks = innerSpans[0]?.marks ?? [];
        continue;
      }
      if (!tok.selfClosing) skipUntilClose(s, tok.name);
      continue;
    }
    s.pos += 1;
  }
  if (!bodyText) bodyText = href.replace(/^confluence:\/\/[^/]+\//, '');
  const key = s.keys.mark();
  markDefs.push({ _type: 'link', _key: key, href });
  return [{
    _type: 'span',
    _key: s.keys.span(),
    text: bodyText,
    marks: [...inheritedMarks, ...bodyMarks.filter(m => !inheritedMarks.includes(m)), key],
  }];
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

function handleMacro(s: ParserState, attrs: Record<string, string>): void {
  const name = attrs['ac:name'] ?? '';
  // For known macros we extract structured content; everything else is dropped.
  if (name === 'code') {
    let language: string | null = null;
    let body = '';
    while (s.pos < s.tokens.length) {
      const tok = s.tokens[s.pos]!;
      if (tok.kind === 'close' && tok.name === 'ac:structured-macro') {
        s.pos += 1;
        break;
      }
      if (tok.kind === 'open') {
        s.pos += 1;
        if (tok.name === 'ac:parameter' && (tok.attrs['ac:name'] ?? '') === 'language') {
          // Read CDATA / text inside.
          while (s.pos < s.tokens.length) {
            const inner = s.tokens[s.pos]!;
            if (inner.kind === 'close' && inner.name === 'ac:parameter') {
              s.pos += 1;
              break;
            }
            if (inner.kind === 'text') language = (language ?? '') + inner.text;
            else if (inner.kind === 'cdata') language = (language ?? '') + inner.text;
            s.pos += 1;
          }
          continue;
        }
        if (tok.name === 'ac:plain-text-body') {
          while (s.pos < s.tokens.length) {
            const inner = s.tokens[s.pos]!;
            if (inner.kind === 'close' && inner.name === 'ac:plain-text-body') {
              s.pos += 1;
              break;
            }
            if (inner.kind === 'cdata') body += inner.text;
            else if (inner.kind === 'text') body += inner.text;
            s.pos += 1;
          }
          continue;
        }
        if (!tok.selfClosing) skipUntilClose(s, tok.name);
        continue;
      }
      s.pos += 1;
    }
    s.out.push({
      _type: 'code',
      _key: s.keys.block(),
      code: body,
      language: language ? language.trim() : null,
    } as unknown as PortableTextBlock);
    return;
  }
  if (PANEL_MACROS.has(name)) {
    const markDefs: PortableTextMarkDefinition[] = [];
    const children: PortableTextSpan[] = [];
    while (s.pos < s.tokens.length) {
      const tok = s.tokens[s.pos]!;
      if (tok.kind === 'close' && tok.name === 'ac:structured-macro') {
        s.pos += 1;
        break;
      }
      if (tok.kind === 'open') {
        s.pos += 1;
        if (tok.name === 'ac:rich-text-body') {
          // Collect the inline spans inside the body. Multiple `<p>` siblings
          // are joined with a newline so the macro stays a single PT block.
          while (s.pos < s.tokens.length) {
            const inner = s.tokens[s.pos]!;
            if (inner.kind === 'close' && inner.name === 'ac:rich-text-body') {
              s.pos += 1;
              break;
            }
            if (inner.kind === 'open' && inner.name === 'p') {
              s.pos += 1;
              const innerSpans = collectInline(s, 'p', markDefs);
              if (children.length > 0) children.push({ _type: 'span', _key: s.keys.span(), text: '\n', marks: [] });
              children.push(...innerSpans);
              continue;
            }
            if (inner.kind === 'text') {
              if (inner.text.length) children.push({ _type: 'span', _key: s.keys.span(), text: inner.text, marks: [] });
              s.pos += 1;
              continue;
            }
            s.pos += 1;
          }
          continue;
        }
        if (!tok.selfClosing) skipUntilClose(s, tok.name);
        continue;
      }
      s.pos += 1;
    }
    s.out.push({
      _type: 'confluence:macro',
      _key: s.keys.block(),
      macroName: name,
      markDefs,
      children: children.length ? children : [{ _type: 'span', _key: s.keys.span(), text: '', marks: [] }],
    } as unknown as PortableTextBlock);
    return;
  }
  // Unknown macro — drop entirely.
  skipUntilClose(s, 'ac:structured-macro');
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

export function confluenceStorageToPortableText(input: string): PortableTextDocument {
  const keys = newKeys();
  const state: ParserState = {
    tokens: tokenise(input),
    pos: 0,
    keys,
    out: [],
  };
  while (state.pos < state.tokens.length) {
    const tok = state.tokens[state.pos]!;
    if (tok.kind === 'text') {
      // Top-level stray text — only emit if non-whitespace.
      if (tok.text.trim()) {
        emitBlock(state, 'normal', [], [{ _type: 'span', _key: keys.span(), text: tok.text, marks: [] }]);
      }
      state.pos += 1;
      continue;
    }
    if (tok.kind === 'cdata') {
      state.pos += 1;
      continue;
    }
    if (tok.kind === 'close') {
      state.pos += 1;
      continue;
    }
    state.pos += 1;
    const name = tok.name;
    const m = /^h([1-6])$/.exec(name);
    if (m) {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(state, name, markDefs);
      emitBlock(state, `h${m[1]}`, markDefs, children);
      continue;
    }
    if (name === 'p') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(state, 'p', markDefs);
      emitBlock(state, 'normal', markDefs, children);
      continue;
    }
    if (name === 'blockquote') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(state, 'blockquote', markDefs);
      emitBlock(state, 'blockquote', markDefs, children);
      continue;
    }
    if (name === 'hr') {
      if (!tok.selfClosing) skipUntilClose(state, 'hr');
      state.out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      continue;
    }
    if (name === 'ul' || name === 'ol') {
      handleList(state, name);
      continue;
    }
    if (name === 'ac:structured-macro') {
      handleMacro(state, tok.attrs);
      continue;
    }
    if (!tok.selfClosing) skipUntilClose(state, name);
  }
  return state.out;
}

// --- PT -> CSF ------------------------------------------------------------

const DECORATOR_TO_TAG: Record<string, string> = {
  strong: 'strong',
  em: 'em',
  underline: 'u',
  'strike-through': 's',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

function spanToCsf(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): string {
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
    if (href.startsWith('confluence://page/')) {
      const rest = href.slice('confluence://page/'.length);
      const parts = rest.split('/');
      const title = parts.length > 1 ? parts.slice(1).join('/') : rest;
      const space = parts.length > 1 ? parts[0] : '';
      const ri = space
        ? `<ri:page ri:space-key="${escapeXml(space ?? '')}" ri:content-title="${escapeXml(title)}"/>`
        : `<ri:page ri:content-title="${escapeXml(title)}"/>`;
      text = `<ac:link>${ri}<ac:plain-text-link-body><![CDATA[${span.text}]]></ac:plain-text-link-body></ac:link>`;
    } else if (href.startsWith('confluence://attachment/')) {
      const fname = href.slice('confluence://attachment/'.length);
      text = `<ac:link><ri:attachment ri:filename="${
        escapeXml(fname)
      }"/><ac:plain-text-link-body><![CDATA[${span.text}]]></ac:plain-text-link-body></ac:link>`;
    } else {
      text = `<a href="${escapeXml(href)}">${text}</a>`;
    }
  }
  return text;
}

export function portableTextToConfluenceStorage(doc: PortableTextDocument): string {
  const out: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  const flushList = (): void => {
    if (listTag) out.push(`</${listTag}>`);
    listTag = null;
  };
  const ensureList = (want: 'ul' | 'ol'): void => {
    if (listTag !== want) {
      flushList();
      listTag = want;
      out.push(`<${want}>`);
    }
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      flushList();
      out.push('<hr/>');
      continue;
    }
    if (t === 'code') {
      flushList();
      const code = String((block as { code?: unknown }).code ?? '');
      const language = (block as { language?: unknown }).language;
      const langParam = typeof language === 'string' && language
        ? `<ac:parameter ac:name="language">${escapeXml(language)}</ac:parameter>`
        : '';
      out.push(
        `<ac:structured-macro ac:name="code">${langParam}<ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`,
      );
      continue;
    }
    if (t === 'confluence:macro') {
      flushList();
      const macroName = String((block as { macroName?: unknown }).macroName ?? 'info');
      const children = ((block as { children?: PortableTextSpan[] }).children ?? []) as PortableTextSpan[];
      const markDefs = ((block as { markDefs?: unknown }).markDefs ?? []) as PortableTextMarkDefinition[];
      const text = children.map(s => spanToCsf(s, markDefs)).join('');
      out.push(
        `<ac:structured-macro ac:name="${
          escapeXml(macroName)
        }"><ac:rich-text-body><p>${text}</p></ac:rich-text-body></ac:structured-macro>`,
      );
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const text = ((b.children ?? []) as PortableTextSpan[]).map(s => spanToCsf(s, markDefs)).join('');
    if (b.listItem === 'bullet') {
      ensureList('ul');
      out.push(`<li>${text}</li>`);
      continue;
    }
    if (b.listItem === 'number') {
      ensureList('ol');
      out.push(`<li>${text}</li>`);
      continue;
    }
    flushList();
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      out.push(`<h${headingMatch[1]}>${text}</h${headingMatch[1]}>`);
    } else if (style === 'blockquote') {
      out.push(`<blockquote>${text}</blockquote>`);
    } else {
      out.push(`<p>${text}</p>`);
    }
  }
  flushList();
  return out.join('\n');
}

// --- Format ---------------------------------------------------------------

export const confluenceStorageFormat: Format = {
  id: 'confluence-storage',
  label: 'Confluence Storage Format',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return confluenceStorageToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToConfluenceStorage(doc);
  },

  detect(value: string): number {
    if (value.trim() === '') return 0;
    let hits = 0;
    if (/<ac:structured-macro\b/.test(value)) hits += 3;
    if (/<ri:(?:page|attachment|url)\b/.test(value)) hits += 2;
    if (/<ac:plain-text-body\b/.test(value)) hits += 2;
    if (/<ac:rich-text-body\b/.test(value)) hits += 1;
    if (/<ac:link\b/.test(value)) hits += 1;
    return Math.min(1, hits * 0.18);
  },
};

export default confluenceStorageFormat;
