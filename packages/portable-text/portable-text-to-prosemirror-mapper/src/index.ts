import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/**
 * ProseMirror / Tiptap JSON <-> Portable Text.
 *
 * The ProseMirror schema (also used by Tiptap and a few headless editors)
 * shares a similar shape to Portable Text but uses different node names and a
 * top-level `doc` wrapper.
 *
 *  - `doc.content[…]` are the top-level blocks.
 *  - `paragraph` → `_type: 'block'`, `style: 'normal'`.
 *  - `heading` with `attrs.level` → `h1`..`h6`.
 *  - `bulletList`/`bullet_list` / `orderedList`/`ordered_list` with
 *    `listItem`/`list_item` children → PT list blocks (level-flattened).
 *  - `blockquote` → `style: 'blockquote'`.
 *  - `codeBlock`/`code_block` → `_type: 'code'`.
 *  - `text` with `marks: [{ type }]` → PT span with decorators.
 *  - The `link` mark (with `attrs.href`) → PT link annotation.
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

const MARK_TO_DECORATOR: Record<string, string> = {
  bold: 'strong',
  strong: 'strong',
  italic: 'em',
  em: 'em',
  code: 'code',
  strike: 'strike-through',
  s: 'strike-through',
  underline: 'underline',
  subscript: 'sub',
  superscript: 'sup',
  highlight: 'highlight',
};

const DECORATOR_TO_MARK: Record<string, string> = {
  strong: 'bold',
  em: 'italic',
  code: 'code',
  'strike-through': 'strike',
  underline: 'underline',
  sub: 'subscript',
  sup: 'superscript',
  highlight: 'highlight',
};

interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string, attrs?: Record<string, unknown> }>;
  text?: string;
  content?: PmNode[];
}

// --- PT -> ProseMirror ----------------------------------------------------

function spanToPm(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): PmNode {
  const marks: PmNode['marks'] = [];
  const decorators = (span.marks ?? []).filter(m => !markDefs.find(d => d._key === m));
  for (const d of decorators) {
    const type = DECORATOR_TO_MARK[d];
    if (type) marks.push({ type });
  }
  const linkKey = (span.marks ?? []).find(m => markDefs.find(d => d._key === m));
  if (linkKey) {
    const def = markDefs.find(d => d._key === linkKey);
    if (def && def._type === 'link') {
      marks.push({ type: 'link', attrs: { href: String(def.href ?? '') } });
    }
  }
  return { type: 'text', text: span.text ?? '', ...(marks.length ? { marks } : {}) };
}

function spansToPm(block: PortableTextBlock): PmNode[] {
  const markDefs = block.markDefs ?? [];
  return (block.children ?? [])
    .filter((c): c is PortableTextSpan => (c as { _type?: string })._type === 'span')
    .map(span => spanToPm(span, markDefs));
}

function isListBlock(value: unknown): value is PortableTextBlock {
  return (
    !!value
    && typeof value === 'object'
    && (value as { _type?: string })._type === 'block'
    && typeof (value as { listItem?: unknown }).listItem === 'string'
  );
}

function blockToPm(block: PortableTextBlock | Record<string, unknown>): PmNode | null {
  const type = (block as { _type?: string })._type;
  if (type === 'block') {
    const tb = block as PortableTextBlock;
    const style = tb.style ?? 'normal';
    const content = spansToPm(tb);
    const m = /^h([1-6])$/.exec(style);
    if (m) return { type: 'heading', attrs: { level: Number(m[1]) }, content };
    if (style === 'blockquote') return { type: 'blockquote', content: [{ type: 'paragraph', content }] };
    return { type: 'paragraph', content };
  }
  if (type === 'code') {
    const code = String((block as Record<string, unknown>).code ?? '');
    const language = (block as Record<string, unknown>).language as string | null | undefined;
    return {
      type: 'codeBlock',
      attrs: language ? { language } : {},
      content: code ? [{ type: 'text', text: code }] : [],
    };
  }
  return null;
}

export function portableTextToProseMirror(doc: PortableTextDocument): PmNode {
  const content: PmNode[] = [];
  let i = 0;
  while (i < doc.length) {
    const block = doc[i]!;
    if (isListBlock(block)) {
      const first = block;
      const listType = first.listItem === 'number' ? 'orderedList' : 'bulletList';
      const items: PmNode[] = [];
      while (
        i < doc.length
        && isListBlock(doc[i])
        && ((doc[i] as PortableTextBlock).listItem === first.listItem)
      ) {
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: spansToPm(doc[i] as PortableTextBlock) }],
        });
        i += 1;
      }
      content.push({ type: listType, content: items });
      continue;
    }
    const node = blockToPm(block);
    if (node) content.push(node);
    i += 1;
  }
  return { type: 'doc', content };
}

// --- ProseMirror -> PT ----------------------------------------------------

function pmTextToSpans(
  nodes: PmNode[],
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
): PortableTextSpan[] {
  const spans: PortableTextSpan[] = [];
  for (const node of nodes) {
    if (node.type !== 'text') continue;
    const decorators: string[] = [];
    let linkKey: string | undefined;
    for (const m of node.marks ?? []) {
      if (m.type === 'link') {
        const href = String((m.attrs as { href?: unknown })?.href ?? '');
        linkKey = keys.mark();
        markDefs.push({ _type: 'link', _key: linkKey, href });
      } else {
        const decorator = MARK_TO_DECORATOR[m.type];
        if (decorator) decorators.push(decorator);
      }
    }
    spans.push({
      _type: 'span',
      _key: keys.span(),
      text: node.text ?? '',
      marks: linkKey ? [...decorators, linkKey] : decorators,
    });
  }
  return spans;
}

function pmBlockToPt(node: PmNode, keys: Keys, out: PortableTextDocument): void {
  if (node.type === 'paragraph') {
    const markDefs: PortableTextMarkDefinition[] = [];
    const spans = pmTextToSpans(node.content ?? [], markDefs, keys);
    out.push({ _type: 'block', _key: keys.block(), style: 'normal', markDefs, children: spans });
    return;
  }
  if (node.type === 'heading') {
    const level = (node.attrs?.level ?? 1) as number;
    const markDefs: PortableTextMarkDefinition[] = [];
    const spans = pmTextToSpans(node.content ?? [], markDefs, keys);
    out.push({
      _type: 'block',
      _key: keys.block(),
      style: `h${level}`,
      markDefs,
      children: spans,
    });
    return;
  }
  if (node.type === 'blockquote') {
    // Flatten to a single blockquote block — collect all inline text from nested paragraphs.
    const inline: PmNode[] = [];
    const walk = (n: PmNode): void => {
      if (n.type === 'text') inline.push(n);
      else if (n.content) { for (const c of n.content) walk(c); }
    };
    for (const c of node.content ?? []) walk(c);
    const markDefs: PortableTextMarkDefinition[] = [];
    const spans = pmTextToSpans(inline, markDefs, keys);
    out.push({ _type: 'block', _key: keys.block(), style: 'blockquote', markDefs, children: spans });
    return;
  }
  if (node.type === 'codeBlock' || node.type === 'code_block') {
    const code = (node.content ?? [])
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('');
    const language = (node.attrs?.language ?? null) as string | null;
    out.push({ _type: 'code', _key: keys.block(), code, language });
    return;
  }
  if (
    node.type === 'bulletList'
    || node.type === 'bullet_list'
    || node.type === 'orderedList'
    || node.type === 'ordered_list'
  ) {
    const listItem: 'bullet' | 'number' = node.type === 'orderedList' || node.type === 'ordered_list'
      ? 'number'
      : 'bullet';
    for (const item of node.content ?? []) {
      if (item.type !== 'listItem' && item.type !== 'list_item') continue;
      // Flatten the first paragraph's children, ignore nested lists.
      const para = (item.content ?? []).find(c => c.type === 'paragraph');
      const markDefs: PortableTextMarkDefinition[] = [];
      const spans = pmTextToSpans(para?.content ?? [], markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        listItem,
        level: 1,
        markDefs,
        children: spans,
      });
    }
    return;
  }
  // Unknown — recurse if it has content.
  if (node.content) { for (const c of node.content) pmBlockToPt(c, keys, out); }
}

export function proseMirrorToPortableText(input: PmNode | string): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const doc: PmNode | null = typeof input === 'string'
    ? ((): PmNode | null => {
      try {
        return JSON.parse(input) as PmNode;
      } catch {
        return null;
      }
    })()
    : input;
  if (!doc) return out;
  if (doc.type === 'doc' || doc.type === undefined) {
    for (const child of doc.content ?? []) pmBlockToPt(child, keys, out);
  } else {
    pmBlockToPt(doc, keys, out);
  }
  return out;
}

// --- Format ---------------------------------------------------------------

export const proseMirrorFormat: Format = {
  id: 'prosemirror',
  label: 'ProseMirror / Tiptap JSON',

  toPortableText(value: string): PortableTextDocument {
    if (value.trim() === '') return [];
    return proseMirrorToPortableText(value);
  },

  fromPortableText(doc: PortableTextDocument): string {
    return JSON.stringify(portableTextToProseMirror(doc), null, 2);
  },

  detect(value: string): number {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return 0;
    try {
      const parsed = JSON.parse(trimmed) as PmNode;
      if (parsed.type === 'doc' && Array.isArray(parsed.content)) return 1;
      return 0;
    } catch {
      return 0;
    }
  },
};

export default proseMirrorFormat;
