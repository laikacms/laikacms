import type { Document } from '@contentful/rich-text-types';
import {
  createKeyGenerator,
  type Format,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

/** Loose Contentful node shape; the document is cast at the boundaries. */
type CfNode = Record<string, any>;

/** Portable Text decorator -> Contentful mark type. `highlight` has no equivalent. */
const DECORATOR_TO_MARK: Record<string, string> = {
  strong: 'bold',
  em: 'italic',
  code: 'code',
  underline: 'underline',
  'strike-through': 'strikethrough',
  sub: 'subscript',
  sup: 'superscript',
};
const MARK_TO_DECORATOR: Record<string, string> = Object.fromEntries(
  Object.entries(DECORATOR_TO_MARK).map(([decorator, mark]) => [mark, decorator]),
);

const HEADING_STYLES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const PT_STYLE_TO_CF: Record<string, string> = {
  h1: 'heading-1',
  h2: 'heading-2',
  h3: 'heading-3',
  h4: 'heading-4',
  h5: 'heading-5',
  h6: 'heading-6',
};
const CF_TO_PT_STYLE: Record<string, string> = {
  paragraph: 'normal',
  'heading-1': 'h1',
  'heading-2': 'h2',
  'heading-3': 'h3',
  'heading-4': 'h4',
  'heading-5': 'h5',
  'heading-6': 'h6',
};

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

// --- Portable Text -> Contentful -------------------------------------------

function textNode(value: string, marks: string[]): CfNode {
  return { nodeType: 'text', value, marks: marks.map(type => ({ type })), data: {} };
}

/** Convert one block's spans into Contentful inline content (text + hyperlinks). */
function spansToContentful(block: PortableTextBlock): CfNode[] {
  const markDefs = block.markDefs ?? [];
  const defKeys = new Set(markDefs.map(def => def._key));
  const out: CfNode[] = [];
  for (const child of block.children ?? []) {
    if ((child as { _type?: string })._type !== 'span') continue;
    const span = child as PortableTextSpan;
    const marks = span.marks ?? [];
    const cfMarks = marks
      .filter(mark => !defKeys.has(mark))
      .map(decorator => DECORATOR_TO_MARK[decorator])
      .filter((mark): mark is string => Boolean(mark));
    const annotationKey = marks.find(mark => defKeys.has(mark));
    const node = textNode(span.text ?? '', cfMarks);
    const def = annotationKey ? markDefs.find(d => d._key === annotationKey) : undefined;
    if (def && def._type === 'link') {
      out.push({ nodeType: 'hyperlink', data: { uri: String(def.href ?? '') }, content: [node] });
    } else {
      out.push(node);
    }
  }
  return out;
}

function isListBlock(value: unknown): value is PortableTextBlock {
  return (
    !!value
    && typeof value === 'object'
    && (value as { _type?: string })._type === 'block'
    && typeof (value as { listItem?: unknown }).listItem === 'string'
  );
}

function paragraph(content: CfNode[]): CfNode {
  return { nodeType: 'paragraph', data: {}, content };
}

/** Nest a run of consecutive Portable Text list blocks into Contentful lists. */
function buildContentfulLists(run: PortableTextBlock[]): CfNode[] {
  const roots: CfNode[] = [];
  const stack: Array<{ level: number, list: CfNode }> = [];

  for (const block of run) {
    const level = typeof block.level === 'number' && block.level > 0 ? block.level : 1;
    const nodeType = block.listItem === 'number' ? 'ordered-list' : 'unordered-list';

    while (stack.length > 0 && stack[stack.length - 1]!.level > level) stack.pop();
    let top = stack[stack.length - 1];

    if (!top || top.level < level) {
      const list: CfNode = { nodeType, data: {}, content: [] };
      if (top) {
        const items = top.list.content as CfNode[];
        const lastItem = items[items.length - 1];
        if (lastItem) (lastItem.content as CfNode[]).push(list);
      } else {
        roots.push(list);
      }
      top = { level, list };
      stack.push(top);
    } else if (top.list.nodeType !== nodeType) {
      const list: CfNode = { nodeType, data: {}, content: [] };
      if (stack.length > 1) {
        const items = stack[stack.length - 2]!.list.content as CfNode[];
        const lastItem = items[items.length - 1];
        if (lastItem) (lastItem.content as CfNode[]).push(list);
      } else {
        roots.push(list);
      }
      stack[stack.length - 1] = { level, list };
      top = stack[stack.length - 1]!;
    }

    (top.list.content as CfNode[]).push({
      nodeType: 'list-item',
      data: {},
      content: [paragraph(spansToContentful(block))],
    });
  }
  return roots;
}

/** Convert a Portable Text document to a Contentful Rich Text document. */
export function portableTextToContentful(doc: PortableTextDocument): Document {
  const content: CfNode[] = [];
  const blocks = Array.isArray(doc) ? doc : [];

  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index]!;
    if (isListBlock(block)) {
      const run: PortableTextBlock[] = [];
      while (index < blocks.length && isListBlock(blocks[index])) {
        run.push(blocks[index] as PortableTextBlock);
        index += 1;
      }
      content.push(...buildContentfulLists(run));
      continue;
    }

    const type = (block as { _type?: string })._type;
    if (type === 'block') {
      const textBlock = block as PortableTextBlock;
      const style = textBlock.style ?? 'normal';
      const inline = spansToContentful(textBlock);
      if (style === 'blockquote') {
        content.push({ nodeType: 'blockquote', data: {}, content: [paragraph(inline)] });
      } else if (HEADING_STYLES.has(style)) {
        content.push({ nodeType: PT_STYLE_TO_CF[style]!, data: {}, content: inline });
      } else {
        content.push(paragraph(inline));
      }
    } else if (type === 'code') {
      const code = String((block as Record<string, unknown>).code ?? '');
      content.push(paragraph([textNode(code, ['code'])]));
    }
    // Custom (non-block) types have no portable Contentful representation — skipped.
    index += 1;
  }

  return { nodeType: 'document', data: {}, content } as unknown as Document;
}

// --- Contentful -> Portable Text -------------------------------------------

function contentfulMarksToDecorators(marks: unknown): string[] {
  if (!Array.isArray(marks)) return [];
  return marks
    .map(mark => MARK_TO_DECORATOR[(mark as { type?: string })?.type ?? ''])
    .filter((decorator): decorator is string => Boolean(decorator));
}

/** Convert a Contentful inline content array into Portable Text spans. */
function contentfulInlineToSpans(
  content: CfNode[],
  markDefs: PortableTextMarkDefinition[],
  keys: Keys,
): PortableTextSpan[] {
  const spans: PortableTextSpan[] = [];
  const pushText = (node: CfNode, linkKey: string | undefined): void => {
    const decorators = contentfulMarksToDecorators(node.marks);
    spans.push({
      _type: 'span',
      _key: keys.span(),
      text: typeof node.value === 'string' ? node.value : '',
      marks: linkKey ? [...decorators, linkKey] : decorators,
    });
  };
  for (const node of content) {
    if (node.nodeType === 'text') {
      pushText(node, undefined);
    } else if (node.nodeType === 'hyperlink') {
      const key = keys.mark();
      markDefs.push({ _type: 'link', _key: key, href: String(node.data?.uri ?? '') });
      for (const inner of (node.content as CfNode[]) ?? []) {
        if (inner.nodeType === 'text') pushText(inner, key);
      }
    }
  }
  return spans;
}

/** Gather the inline content of a node, descending through nested paragraphs. */
function collectInline(node: CfNode): CfNode[] {
  const out: CfNode[] = [];
  for (const child of (node.content as CfNode[]) ?? []) {
    if (child.nodeType === 'text' || child.nodeType === 'hyperlink') out.push(child);
    else if (child.nodeType === 'paragraph') out.push(...collectInline(child));
  }
  return out;
}

/** Flatten a Contentful list node into level-tagged Portable Text list blocks. */
function flattenContentfulList(
  list: CfNode,
  level: number,
  out: PortableTextDocument,
  keys: Keys,
): void {
  const listItem = list.nodeType === 'ordered-list' ? 'number' : 'bullet';
  for (const item of (list.content as CfNode[]) ?? []) {
    if (item.nodeType !== 'list-item') continue;
    const nested = ((item.content as CfNode[]) ?? []).filter(
      child => child.nodeType === 'unordered-list' || child.nodeType === 'ordered-list',
    );
    const markDefs: PortableTextMarkDefinition[] = [];
    const spans = contentfulInlineToSpans(collectInline(item), markDefs, keys);
    out.push({
      _type: 'block',
      _key: keys.block(),
      style: 'normal',
      listItem,
      level,
      markDefs,
      children: spans,
    });
    for (const child of nested) flattenContentfulList(child, level + 1, out, keys);
  }
}

/** Convert a Contentful Rich Text document to a Portable Text document. */
export function contentfulToPortableText(document: Document): PortableTextDocument {
  const keys = newKeys();
  const out: PortableTextDocument = [];
  const content: CfNode[] = ((document as unknown as CfNode)?.content as CfNode[]) ?? [];

  for (const node of content) {
    if (node.nodeType === 'unordered-list' || node.nodeType === 'ordered-list') {
      flattenContentfulList(node, 1, out, keys);
      continue;
    }
    const markDefs: PortableTextMarkDefinition[] = [];
    if (node.nodeType === 'paragraph' || CF_TO_PT_STYLE[node.nodeType]) {
      const spans = contentfulInlineToSpans(collectInline(node), markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: CF_TO_PT_STYLE[node.nodeType] ?? 'normal',
        markDefs,
        children: spans,
      });
    } else if (node.nodeType === 'blockquote') {
      const spans = contentfulInlineToSpans(collectInline(node), markDefs, keys);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'blockquote',
        markDefs,
        children: spans,
      });
    }
    // `hr` and embedded entries have no Portable Text equivalent here — skipped.
  }
  return out;
}

// --- Format ----------------------------------------------------------------

/** The Contentful Rich Text format. */
export const contentfulRtfFormat: Format = {
  id: 'contentful-rtf',
  label: 'Contentful Rich Text',

  toPortableText(value: string): PortableTextDocument {
    const trimmed = value.trim();
    if (trimmed === '') return [];
    try {
      const parsed = JSON.parse(trimmed) as Document;
      return contentfulToPortableText(parsed);
    } catch {
      return [];
    }
  },

  fromPortableText(doc: PortableTextDocument): string {
    return JSON.stringify(portableTextToContentful(doc), null, 2);
  },

  detect(value: string): number {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return 0;
    try {
      const parsed = JSON.parse(trimmed) as { nodeType?: string, content?: unknown };
      return parsed.nodeType === 'document' && Array.isArray(parsed.content) ? 1 : 0;
    } catch {
      return 0;
    }
  },
};

export default contentfulRtfFormat;
