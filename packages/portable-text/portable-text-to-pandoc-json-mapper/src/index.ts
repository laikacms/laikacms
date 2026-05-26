import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Pandoc JSON (native AST) <-> Portable Text.
 *
 * Pandoc emits its internal AST as JSON when given `-t json`, with the shape:
 *
 *     {
 *       "pandoc-api-version": [1, 23],
 *       "meta": { … },
 *       "blocks": [ { "t": "Header", "c": [ … ] }, … ]
 *     }
 *
 * Each node has a `t` (type tag, e.g. `Header`, `Para`, `Str`, `Emph`) and a
 * `c` payload whose shape depends on the type. We model the block & inline
 * types that map onto Portable Text:
 *
 *   Blocks:
 *     - `Header(level, attr, inlines)`        → block style `h1`..`h6`
 *     - `Para(inlines)` / `Plain(inlines)`    → block style `normal`
 *     - `BlockQuote(blocks)`                  → block style `blockquote`
 *     - `CodeBlock(attr, text)`               → `code` block (attr classes
 *                                                supply `language`)
 *     - `BulletList(items)` / `OrderedList`   → list blocks (bullet / number)
 *     - `HorizontalRule`                      → `hr` block
 *
 *   Inlines:
 *     - `Str(text)`                           → text span
 *     - `Space` / `SoftBreak`                 → space character
 *     - `LineBreak`                           → `\n`
 *     - `Emph(inlines)`                       → `em`
 *     - `Strong(inlines)`                     → `strong`
 *     - `Underline(inlines)`                  → `underline`
 *     - `Strikeout(inlines)`                  → `strike-through`
 *     - `Subscript` / `Superscript`           → `sub` / `sup`
 *     - `Code(attr, text)`                    → `code` decorator
 *     - `Link(attr, inlines, [url, title])`   → `markDefs[link]`
 *
 * Definition lists, tables, raw blocks, images, math, citations, notes, and
 * the wider Pandoc extension set are intentionally out of scope.
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

interface PandocNode {
  t: string;
  c?: unknown;
}

interface PandocDoc {
  'pandoc-api-version'?: number[];
  meta?: Record<string, unknown>;
  blocks?: PandocNode[];
}

// --- Inline mapping -------------------------------------------------------

const INLINE_DECORATORS: Record<string, string> = {
  Emph: 'em',
  Strong: 'strong',
  Underline: 'underline',
  Strikeout: 'strike-through',
  Subscript: 'sub',
  Superscript: 'sup',
};

function collectInline(
  nodes: PandocNode[] | undefined,
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
  inheritedMarks: string[] = [],
): PortableTextSpan[] {
  const out: PortableTextSpan[] = [];
  if (!nodes) return out;
  for (const node of nodes) {
    if (!node || typeof node.t !== 'string') continue;
    if (node.t === 'Str') {
      const text = typeof node.c === 'string' ? node.c : '';
      pushSpan(out, keys, text, inheritedMarks);
      continue;
    }
    if (node.t === 'Space' || node.t === 'SoftBreak') {
      pushSpan(out, keys, ' ', inheritedMarks);
      continue;
    }
    if (node.t === 'LineBreak') {
      pushSpan(out, keys, '\n', inheritedMarks);
      continue;
    }
    const decorator = INLINE_DECORATORS[node.t];
    if (decorator) {
      out.push(...collectInline(node.c as PandocNode[], markDefs, keys, [...inheritedMarks, decorator]));
      continue;
    }
    if (node.t === 'Code') {
      // Code(attr, text)
      const c = node.c as [unknown, string] | undefined;
      const text = Array.isArray(c) && typeof c[1] === 'string' ? c[1] : '';
      pushSpan(out, keys, text, [...inheritedMarks, 'code']);
      continue;
    }
    if (node.t === 'Link') {
      // Link(attr, inlines, [url, title])
      const c = node.c as [unknown, PandocNode[], [string, string]] | undefined;
      const url = Array.isArray(c) && Array.isArray(c[2]) ? c[2][0] : '';
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: url });
      const inlines = Array.isArray(c) ? (c[1] as PandocNode[]) : [];
      out.push(...collectInline(inlines, markDefs, keys, [...inheritedMarks, key]));
      continue;
    }
    if (node.t === 'Span') {
      // Span(attr, inlines)
      const c = node.c as [unknown, PandocNode[]] | undefined;
      out.push(...collectInline(Array.isArray(c) ? c[1] : [], markDefs, keys, inheritedMarks));
      continue;
    }
    if (node.t === 'Quoted' || node.t === 'SmallCaps' || node.t === 'Cite') {
      // Wrappers — flatten contents.
      const c = node.c as [unknown, PandocNode[]] | PandocNode[] | undefined;
      const inlines = Array.isArray(c) && !Array.isArray((c as unknown[])[0])
        ? (c as PandocNode[])
        : (Array.isArray(c) ? (c[1] as PandocNode[]) : []);
      out.push(...collectInline(inlines, markDefs, keys, inheritedMarks));
      continue;
    }
    // Unknown — skip silently.
  }
  return out;
}

function pushSpan(
  arr: PortableTextSpan[],
  keys: Keys,
  text: string,
  marks: string[],
): void {
  if (text.length === 0) return;
  const last = arr[arr.length - 1];
  if (last && JSON.stringify(last.marks) === JSON.stringify(marks)) {
    last.text += text;
    return;
  }
  arr.push({ _type: 'span', _key: keys.span(), text, marks });
}

// --- Block mapping --------------------------------------------------------

function emitParagraph(
  s: PortableTextDocument,
  nodes: PandocNode[] | undefined,
  style: string,
  keys: Keys,
): void {
  const markDefs: PortableTextMarkDefinition[] = [];
  const children = collectInline(nodes, markDefs, keys);
  s.push({
    _type: 'block',
    _key: keys.block(),
    style,
    markDefs,
    children: children.length ? children : [{ _type: 'span', _key: keys.span(), text: '', marks: [] }],
  } as PortableTextBlock);
}

function handleListItem(
  item: PandocNode[],
  listItem: 'bullet' | 'number',
  out: PortableTextDocument,
  keys: Keys,
): void {
  // A list item is a list of blocks. We collapse them: the first
  // Para/Plain/Header becomes the item's PT block (with listItem set); any
  // additional blocks are appended as plain follow-ups at the same level.
  let first = true;
  for (const block of item) {
    if (!block || typeof block.t !== 'string') continue;
    if (block.t === 'Para' || block.t === 'Plain') {
      const markDefs: PortableTextMarkDefinition[] = [];
      const children = collectInline(block.c as PandocNode[], markDefs, keys);
      const ptBlock: PortableTextBlock = {
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs,
        children: children.length ? children : [{ _type: 'span', _key: keys.span(), text: '', marks: [] }],
      };
      if (first) {
        (ptBlock as PortableTextBlock & { listItem: string, level: number }).listItem = listItem;
        (ptBlock as PortableTextBlock & { listItem: string, level: number }).level = 1;
        first = false;
      }
      out.push(ptBlock);
    } else {
      // For nested lists, recurse with deeper level — but the initial cut
      // keeps everything at level 1 for simplicity.
      handleBlock(block, out, keys);
    }
  }
}

function handleBlock(node: PandocNode, out: PortableTextDocument, keys: Keys): void {
  if (!node || typeof node.t !== 'string') return;
  switch (node.t) {
    case 'Header': {
      const c = node.c as [number, unknown, PandocNode[]] | undefined;
      const level = Array.isArray(c) && typeof c[0] === 'number' ? Math.max(1, Math.min(6, c[0])) : 1;
      const inlines = Array.isArray(c) ? c[2] : [];
      emitParagraph(out, inlines, `h${level}`, keys);
      return;
    }
    case 'Para':
    case 'Plain':
      emitParagraph(out, node.c as PandocNode[], 'normal', keys);
      return;
    case 'BlockQuote': {
      const inner = (node.c as PandocNode[]) ?? [];
      // Quote may contain multiple blocks; emit each as blockquote.
      for (const b of inner) {
        if (b.t === 'Para' || b.t === 'Plain') {
          emitParagraph(out, b.c as PandocNode[], 'blockquote', keys);
        } else {
          handleBlock(b, out, keys);
        }
      }
      return;
    }
    case 'CodeBlock': {
      const c = node.c as [[string, string[], Array<[string, string]>] | unknown, string] | undefined;
      let language: string | null = null;
      if (Array.isArray(c) && Array.isArray(c[0])) {
        const classes = (c[0] as [string, string[], unknown])[1];
        if (Array.isArray(classes) && classes.length) language = classes[0]!;
      }
      const text = Array.isArray(c) && typeof c[1] === 'string' ? c[1] : '';
      out.push({
        _type: 'code',
        _key: keys.block(),
        code: text,
        language,
      } as unknown as PortableTextBlock);
      return;
    }
    case 'HorizontalRule':
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      return;
    case 'BulletList': {
      const items = (node.c as PandocNode[][]) ?? [];
      for (const item of items) handleListItem(item, 'bullet', out, keys);
      return;
    }
    case 'OrderedList': {
      // OrderedList(attr, items). The attr describes start number/style.
      const c = node.c as [unknown, PandocNode[][]] | undefined;
      const items = Array.isArray(c) ? c[1] : [];
      for (const item of items) handleListItem(item, 'number', out, keys);
      return;
    }
    case 'RawBlock':
    case 'Null':
    case 'Div':
    default:
      // Unknown / unhandled — flatten Div contents, otherwise drop.
      if (node.t === 'Div') {
        const c = node.c as [unknown, PandocNode[]] | undefined;
        const blocks = Array.isArray(c) ? c[1] : [];
        for (const b of blocks) handleBlock(b, out, keys);
      }
      return;
  }
}

export function pandocJsonToPortableText(input: string | PandocDoc): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  let doc: PandocDoc;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input) as PandocDoc;
    } catch {
      return [];
    }
  } else {
    doc = input;
  }
  for (const block of doc.blocks ?? []) handleBlock(block, out, keys);
  return out;
}

// --- PT -> Pandoc JSON ----------------------------------------------------

const DECORATOR_TO_PANDOC: Record<string, string> = {
  strong: 'Strong',
  em: 'Emph',
  underline: 'Underline',
  'strike-through': 'Strikeout',
  sub: 'Subscript',
  sup: 'Superscript',
};

interface InlineNode {
  t: string;
  c?: unknown;
}

function textToInlines(text: string): InlineNode[] {
  // Convert a plain text run into Pandoc's Str / Space / LineBreak token sequence.
  const out: InlineNode[] = [];
  // Split on newlines first so LineBreak is preserved.
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (idx > 0) out.push({ t: 'LineBreak' });
    // Split each line by single spaces into Str + Space + Str + ... runs.
    const tokens = line.split(/( )/);
    for (const tok of tokens) {
      if (tok === '') continue;
      if (tok === ' ') out.push({ t: 'Space' });
      else out.push({ t: 'Str', c: tok });
    }
  });
  return out;
}

function spanToPandocInlines(
  span: PortableTextSpan,
  markDefs: PortableTextMarkDefinition[],
): InlineNode[] {
  let inlines = textToInlines(span.text);
  const marks = span.marks ?? [];
  const linkKey = marks.find(m => markDefs.some(d => d._key === m && d._type === 'link'));
  // Wrap decorators inner-most-first.
  for (const mark of marks) {
    if (mark === linkKey) continue;
    if (mark === 'code') {
      // Code(attr, text) — collapse the inlines back to plain text.
      const text = inlinesToPlainText(inlines);
      inlines = [{ t: 'Code', c: [['', [], []], text] }];
      continue;
    }
    const pandocTag = DECORATOR_TO_PANDOC[mark];
    if (pandocTag) inlines = [{ t: pandocTag, c: inlines }];
  }
  if (linkKey) {
    const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
    inlines = [{ t: 'Link', c: [['', [], []], inlines, [href, '']] }];
  }
  return inlines;
}

function inlinesToPlainText(nodes: InlineNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'Str') out += String(n.c ?? '');
    else if (n.t === 'Space' || n.t === 'SoftBreak') out += ' ';
    else if (n.t === 'LineBreak') out += '\n';
    else if (Array.isArray(n.c)) out += inlinesToPlainText(n.c as InlineNode[]);
  }
  return out;
}

export function portableTextToPandocJson(doc: PortableTextDocument): string {
  const blocks: PandocNode[] = [];
  // List-item batching: consecutive bullet/number blocks collapse into a
  // single BulletList/OrderedList node.
  let pendingListKind: 'bullet' | 'number' | null = null;
  let pendingListItems: PandocNode[][] = [];
  const flushList = (): void => {
    if (pendingListKind === null) return;
    if (pendingListKind === 'bullet') {
      blocks.push({ t: 'BulletList', c: pendingListItems });
    } else {
      // OrderedList attr: [startNum, [Decimal], [Period]] — we use defaults.
      blocks.push({
        t: 'OrderedList',
        c: [[1, { t: 'Decimal' }, { t: 'Period' }], pendingListItems],
      });
    }
    pendingListKind = null;
    pendingListItems = [];
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'hr') {
      flushList();
      blocks.push({ t: 'HorizontalRule' });
      continue;
    }
    if (t === 'code') {
      flushList();
      const code = String((block as { code?: unknown }).code ?? '');
      const language = (block as { language?: unknown }).language;
      const classes = typeof language === 'string' && language ? [language] : [];
      blocks.push({ t: 'CodeBlock', c: [['', classes, []], code] });
      continue;
    }
    if (t !== 'block') continue;
    const b = block as PortableTextBlock;
    const markDefs = (b.markDefs ?? []) as PortableTextMarkDefinition[];
    const inlines: InlineNode[] = [];
    for (const span of (b.children ?? []) as PortableTextSpan[]) {
      inlines.push(...spanToPandocInlines(span, markDefs));
    }
    if (b.listItem === 'bullet' || b.listItem === 'number') {
      const want: 'bullet' | 'number' = b.listItem === 'number' ? 'number' : 'bullet';
      if (pendingListKind !== null && pendingListKind !== want) flushList();
      pendingListKind = want;
      pendingListItems.push([{ t: 'Para', c: inlines }]);
      continue;
    }
    flushList();
    const style = b.style ?? 'normal';
    const headingMatch = /^h([1-6])$/.exec(style);
    if (headingMatch) {
      blocks.push({ t: 'Header', c: [Number(headingMatch[1]), ['', [], []], inlines] });
    } else if (style === 'blockquote') {
      blocks.push({ t: 'BlockQuote', c: [{ t: 'Para', c: inlines }] });
    } else {
      blocks.push({ t: 'Para', c: inlines });
    }
  }
  flushList();
  const doc2: PandocDoc = {
    'pandoc-api-version': [1, 23],
    meta: {},
    blocks,
  };
  return JSON.stringify(doc2);
}

// --- Format ---------------------------------------------------------------

export const pandocJsonFormat: Format = {
  id: 'pandoc-json',
  label: 'Pandoc JSON',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return pandocJsonToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return portableTextToPandocJson(doc);
  },

  detect(value: string): number {
    const s = value.trim();
    if (!s.startsWith('{')) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      return 0;
    }
    if (typeof parsed !== 'object' || parsed === null) return 0;
    const obj = parsed as Record<string, unknown>;
    let hits = 0;
    if (Array.isArray(obj['pandoc-api-version'])) hits += 3;
    if (Array.isArray(obj.blocks)) {
      hits += 1;
      const first = obj.blocks[0] as Record<string, unknown> | undefined;
      if (first && typeof first.t === 'string') hits += 2;
    }
    if (typeof obj.meta === 'object') hits += 1;
    return Math.min(1, hits * 0.22);
  },
};

export default pandocJsonFormat;
