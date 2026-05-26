import { createKeyGenerator, type Format, type PortableTextDocument } from '@laikacloud/portabletext-core';
import type { PortableTextBlock, PortableTextMarkDefinition, PortableTextSpan } from '@portabletext/types';

/**
 * Slate JSON <-> Portable Text.
 *
 * Slate documents are arrays of `Node`s; an element has `type` + `children`,
 * a text leaf has `text` plus boolean mark flags (`bold`, `italic`, …). The
 * type names below are the classic Slate / `@udecode/plate` conventions:
 *
 *   - `paragraph`                                   → block, style `normal`
 *   - `heading-one` .. `heading-six`                → block, style `h1`..`h6`
 *   - `block-quote`                                 → block, style `blockquote`
 *   - `code-block` whose children are `code-line`s  → `code` block
 *   - `bulleted-list` / `numbered-list` of `list-item`s → blocks with listItem
 *   - `link` (inline)                               → `markDefs[link]`
 *   - `image` (block)                               → `image` custom block
 *   - `thematic-break`                              → `hr` custom block
 *
 * Marks recognised on leaves: `bold`, `italic`, `underline`, `strikethrough`,
 * `code`.
 */

interface SlateText {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
}
interface SlateElement {
  type: string;
  children: SlateNode[];
  [extra: string]: unknown;
}
type SlateNode = SlateText | SlateElement;

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

function isText(n: SlateNode): n is SlateText {
  return typeof (n as SlateText).text === 'string';
}

const STYLE_TO_TYPE: Record<string, string> = {
  normal: 'paragraph',
  h1: 'heading-one',
  h2: 'heading-two',
  h3: 'heading-three',
  h4: 'heading-four',
  h5: 'heading-five',
  h6: 'heading-six',
  blockquote: 'block-quote',
};
const TYPE_TO_STYLE: Record<string, string> = Object.fromEntries(
  Object.entries(STYLE_TO_TYPE).map(([k, v]) => [v, k]),
);

const MARK_KEYS = ['bold', 'italic', 'underline', 'strikethrough', 'code'] as const;
const DECORATOR_FOR_KEY: Record<(typeof MARK_KEYS)[number], string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'underline',
  strikethrough: 'strike-through',
  code: 'code',
};
const KEY_FOR_DECORATOR: Record<string, (typeof MARK_KEYS)[number]> = Object.fromEntries(
  Object.entries(DECORATOR_FOR_KEY).map(([k, v]) => [v, k as (typeof MARK_KEYS)[number]]),
);

// --- Slate -> PT ----------------------------------------------------------

function leafToSpan(
  leaf: SlateText,
  inheritedMarkKeys: string[],
  keys: Keys,
): PortableTextSpan {
  const marks: string[] = [...inheritedMarkKeys];
  for (const k of MARK_KEYS) {
    if (leaf[k]) marks.push(DECORATOR_FOR_KEY[k]);
  }
  return {
    _type: 'span',
    _key: keys.span(),
    text: leaf.text,
    marks,
  };
}

function collectInline(
  children: SlateNode[],
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
  inheritedMarkKeys: string[] = [],
): PortableTextSpan[] {
  const out: PortableTextSpan[] = [];
  for (const node of children) {
    if (isText(node)) {
      out.push(leafToSpan(node, inheritedMarkKeys, keys));
      continue;
    }
    if (node.type === 'link') {
      const href = typeof node.url === 'string' ? node.url : '';
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href });
      out.push(...collectInline(node.children, markDefs, keys, [...inheritedMarkKeys, key]));
      continue;
    }
    // Unknown inline: walk into children with the same mark stack.
    out.push(...collectInline(node.children, markDefs, keys, inheritedMarkKeys));
  }
  return out;
}

function collectListItems(
  element: SlateElement,
  listItem: 'bullet' | 'number',
  level: number,
  keys: Keys,
  out: PortableTextDocument,
): void {
  for (const child of element.children) {
    if (isText(child) || child.type !== 'list-item') continue;
    // A list-item's children may include nested lists; split them out.
    const inlineChildren: SlateNode[] = [];
    const nestedLists: SlateElement[] = [];
    for (const c of child.children) {
      if (!isText(c) && (c.type === 'bulleted-list' || c.type === 'numbered-list')) {
        nestedLists.push(c);
      } else {
        inlineChildren.push(c);
      }
    }
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = collectInline(inlineChildren, markDefs, keys);
    out.push({
      _type: 'block',
      _key: keys.block(),
      style: 'normal',
      markDefs,
      children,
      listItem,
      level,
    } as PortableTextBlock);
    for (const nl of nestedLists) {
      const nextItem = nl.type === 'numbered-list' ? 'number' : 'bullet';
      collectListItems(nl, nextItem, level + 1, keys, out);
    }
  }
}

export function slateToPortableText(input: string | SlateNode[]): PortableTextDocument {
  const keys = newKeys();
  let nodes: SlateNode[];
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input);
      nodes = Array.isArray(parsed) ? (parsed as SlateNode[]) : [];
    } catch {
      return [];
    }
  } else {
    nodes = input;
  }
  const out: PortableTextDocument = [];
  for (const node of nodes) {
    if (isText(node)) {
      // Top-level naked text — wrap in a paragraph.
      const markDefs: PortableTextMarkDefinition[] = [];
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        markDefs,
        children: [leafToSpan(node, [], keys)],
      } as PortableTextBlock);
      continue;
    }
    const t = node.type;
    if (t === 'thematic-break') {
      out.push({ _type: 'hr', _key: keys.block() } as unknown as PortableTextBlock);
      continue;
    }
    if (t === 'image') {
      out.push({
        _type: 'image',
        _key: keys.block(),
        url: String(node.url ?? ''),
        alt: String(node.alt ?? ''),
      } as unknown as PortableTextBlock);
      continue;
    }
    if (t === 'code-block') {
      const codeLines: string[] = [];
      for (const c of node.children) {
        if (isText(c)) codeLines.push(c.text);
        else if (c.type === 'code-line') {
          codeLines.push(c.children.map(g => (isText(g) ? g.text : '')).join(''));
        }
      }
      out.push({
        _type: 'code',
        _key: keys.block(),
        code: codeLines.join('\n'),
        language: typeof node.language === 'string' ? node.language : null,
      } as unknown as PortableTextBlock);
      continue;
    }
    if (t === 'bulleted-list' || t === 'numbered-list') {
      collectListItems(node, t === 'numbered-list' ? 'number' : 'bullet', 1, keys, out);
      continue;
    }
    // Default: paragraph / heading / block-quote / unknown.
    const style = TYPE_TO_STYLE[t] ?? 'normal';
    const markDefs: PortableTextMarkDefinition[] = [];
    const children = collectInline(node.children, markDefs, keys);
    out.push({
      _type: 'block',
      _key: keys.block(),
      style,
      markDefs,
      children,
    } as PortableTextBlock);
  }
  return out;
}

// --- PT -> Slate ----------------------------------------------------------

function spansToSlateChildren(
  spans: PortableTextSpan[],
  markDefs: PortableTextMarkDefinition[],
): SlateNode[] {
  const out: SlateNode[] = [];
  // Group consecutive spans that share the same link markDef into one Slate
  // `link` element; everything else becomes a leaf with mark booleans.
  let i = 0;
  while (i < spans.length) {
    const span = spans[i]!;
    const linkKey = (span.marks ?? []).find(m => markDefs.some(d => d._key === m && d._type === 'link'));
    if (linkKey) {
      const href = (markDefs.find(d => d._key === linkKey) as { href?: string } | undefined)?.href ?? '';
      const group: PortableTextSpan[] = [span];
      let j = i + 1;
      while (j < spans.length) {
        const next = spans[j]!;
        if ((next.marks ?? []).includes(linkKey)) {
          group.push(next);
          j += 1;
        } else break;
      }
      out.push({
        type: 'link',
        url: href,
        children: group.map(g => spanToLeaf(g, markDefs, [linkKey])),
      });
      i = j;
      continue;
    }
    out.push(spanToLeaf(span, markDefs, []));
    i += 1;
  }
  if (out.length === 0) out.push({ text: '' });
  return out;
}

function spanToLeaf(
  span: PortableTextSpan,
  markDefs: PortableTextMarkDefinition[],
  consumedKeys: string[],
): SlateText {
  const leaf: SlateText = { text: span.text };
  for (const mark of span.marks ?? []) {
    if (consumedKeys.includes(mark)) continue;
    const k = KEY_FOR_DECORATOR[mark];
    if (k) leaf[k] = true;
    // Unknown markDef keys (non-link) are silently dropped — only `link` is
    // modelled as a Slate element here.
    void markDefs;
  }
  return leaf;
}

export function portableTextToSlate(doc: PortableTextDocument): SlateNode[] {
  const out: SlateNode[] = [];
  // List grouping: emit consecutive blocks with the same listItem under one
  // top-level Slate list element (nested lists collapse to flat depth-1 in
  // this initial cut — `level` is preserved on round-trip via PT but Slate
  // nesting is harder to reconstruct deterministically).
  let listType: 'bulleted-list' | 'numbered-list' | null = null;
  let listChildren: SlateElement[] = [];
  const flushList = (): void => {
    if (listType && listChildren.length) {
      out.push({ type: listType, children: listChildren });
    }
    listType = null;
    listChildren = [];
  };

  for (const block of doc) {
    const t = (block as { _type?: string })._type;
    if (t === 'block') {
      const b = block as PortableTextBlock;
      if (b.listItem === 'bullet' || b.listItem === 'number') {
        const want = b.listItem === 'number' ? 'numbered-list' : 'bulleted-list';
        if (listType !== want) flushList();
        listType = want;
        listChildren.push({
          type: 'list-item',
          children: spansToSlateChildren(
            (b.children ?? []) as PortableTextSpan[],
            (b.markDefs ?? []) as PortableTextMarkDefinition[],
          ),
        });
        continue;
      }
      flushList();
      const type = STYLE_TO_TYPE[b.style ?? 'normal'] ?? 'paragraph';
      out.push({
        type,
        children: spansToSlateChildren(
          (b.children ?? []) as PortableTextSpan[],
          (b.markDefs ?? []) as PortableTextMarkDefinition[],
        ),
      });
      continue;
    }
    flushList();
    if (t === 'hr') {
      out.push({ type: 'thematic-break', children: [{ text: '' }] });
      continue;
    }
    if (t === 'image') {
      out.push({
        type: 'image',
        url: String((block as { url?: unknown }).url ?? ''),
        alt: String((block as { alt?: unknown }).alt ?? ''),
        children: [{ text: '' }],
      });
      continue;
    }
    if (t === 'code') {
      const code = String((block as { code?: unknown }).code ?? '');
      const lang = (block as { language?: unknown }).language;
      const element: SlateElement = {
        type: 'code-block',
        language: typeof lang === 'string' ? lang : null,
        children: code.split('\n').map(line => ({
          type: 'code-line',
          children: [{ text: line }],
        })),
      };
      out.push(element);
      continue;
    }
  }
  flushList();
  return out;
}

// --- Format ---------------------------------------------------------------

export const slateFormat: Format = {
  id: 'slate',
  label: 'Slate JSON',

  toPortableText(value: string): PortableTextDocument {
    if (value === '') return [];
    return slateToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return JSON.stringify(portableTextToSlate(doc));
  },

  detect(value: string): number {
    const s = value.trim();
    if (!s.startsWith('[')) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      return 0;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return 0;
    let hits = 0;
    let total = 0;
    for (const node of parsed) {
      if (typeof node !== 'object' || node === null) continue;
      total += 1;
      const rec = node as Record<string, unknown>;
      if (typeof rec.type === 'string' && Array.isArray(rec.children)) hits += 1;
    }
    if (total === 0) return 0;
    return Math.min(1, hits / total);
  },
};

export default slateFormat;
