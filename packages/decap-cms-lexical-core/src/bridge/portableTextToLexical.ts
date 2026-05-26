import type { SerializedEditorState } from 'lexical';

import type {
  PortableTextBlock,
  PortableTextDocument,
  PortableTextMarkDefinition,
  PortableTextSpan,
} from '@laikacloud/portabletext-core';
import { createEmptyEditorState } from './empty';
import { decoratorsToFormat, isDecorator } from './marks';

/** Loose serialized-node shape; the whole tree is cast to Lexical types at the end. */
type Lex = Record<string, any>;

const HEADING_STYLES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function textNode(text: string, format: number): Lex {
  return { type: 'text', version: 1, text, format, detail: 0, mode: 'normal', style: '' };
}

function lineBreak(): Lex {
  return { type: 'linebreak', version: 1 };
}

function element(type: string, children: Lex[], extra: Lex = {}): Lex {
  return { type, version: 1, children, direction: null, format: '', indent: 0, ...extra };
}

/** Split text on `\n` into text nodes interleaved with linebreak nodes. */
function inlineFromText(text: string, format: number): Lex[] {
  const parts = text.split('\n');
  const nodes: Lex[] = [];
  parts.forEach((part, index) => {
    if (index > 0) nodes.push(lineBreak());
    if (part !== '' || parts.length === 1) nodes.push(textNode(part, format));
  });
  return nodes;
}

function isSpan(child: unknown): child is PortableTextSpan {
  return !!child && typeof child === 'object' && (child as { _type?: string })._type === 'span';
}

/** Convert one span into inline Lexical nodes (a link node, or bare text nodes). */
function spanToInline(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): Lex[] {
  const marks = span.marks ?? [];
  const format = decoratorsToFormat(marks.filter(isDecorator));
  const inline = inlineFromText(span.text ?? '', format);

  const annotationKey = marks.find(mark => !isDecorator(mark));
  if (annotationKey) {
    const def = markDefs.find(markDef => markDef._key === annotationKey);
    if (def && def._type === 'link' && typeof def.href === 'string') {
      return [
        element('link', inline, {
          url: def.href,
          rel: typeof def.rel === 'string' ? def.rel : null,
          target: typeof def.target === 'string' ? def.target : null,
          title: typeof def.title === 'string' ? def.title : null,
        }),
      ];
    }
  }
  return inline;
}

/** Inline children of a text block. */
function blockChildren(block: PortableTextBlock): Lex[] {
  const markDefs = block.markDefs ?? [];
  const children: Lex[] = [];
  for (const child of block.children ?? []) {
    if (isSpan(child)) children.push(...spanToInline(child, markDefs));
  }
  return children;
}

/** Convert a code block (`{_type:'code', code, language}`) to a Lexical code node. */
function codeNode(obj: Record<string, unknown>): Lex {
  const code = typeof obj.code === 'string' ? obj.code : '';
  const language = typeof obj.language === 'string' ? obj.language : null;
  return element('code', inlineFromText(code, 0), { language });
}

/** Convert an arbitrary custom object to a Lexical BlockNode. */
function customBlockNode(obj: Record<string, unknown>): Lex {
  const { _type, _key, ...data } = obj;
  void _key;
  return { type: 'decap-block', version: 1, componentId: String(_type), data };
}

/** Convert a non-list text block to its Lexical element node. */
function textBlockToLexical(block: PortableTextBlock): Lex {
  const children = blockChildren(block);
  const style = block.style ?? 'normal';
  if (style === 'blockquote') return element('quote', children);
  if (HEADING_STYLES.has(style)) {
    return element('heading', children, { tag: style });
  }
  return element('paragraph', children, { textFormat: 0, textStyle: '' });
}

function isListBlock(value: unknown): value is PortableTextBlock {
  return (
    !!value
    && typeof value === 'object'
    && (value as { _type?: string })._type === 'block'
    && typeof (value as { listItem?: unknown }).listItem === 'string'
  );
}

function listNode(listType: string): Lex {
  return element('list', [], {
    listType,
    start: 1,
    tag: listType === 'number' ? 'ol' : 'ul',
  });
}

function listItemNode(children: Lex[], value: number): Lex {
  return element('listitem', children, { value });
}

/**
 * Group a run of consecutive Portable Text list blocks into nested Lexical
 * lists, using each block's 1-based `level`.
 */
function buildLists(run: PortableTextBlock[]): Lex[] {
  const roots: Lex[] = [];
  const stack: Array<{ level: number, list: Lex }> = [];

  for (const block of run) {
    const level = typeof block.level === 'number' && block.level > 0 ? block.level : 1;
    const listType = block.listItem === 'number' ? 'number' : 'bullet';

    while (stack.length > 0 && stack[stack.length - 1]!.level > level) stack.pop();

    let top = stack[stack.length - 1];
    if (!top || top.level < level) {
      const list = listNode(listType);
      if (top) {
        const parentItems = top.list.children as Lex[];
        const lastItem = parentItems[parentItems.length - 1];
        if (lastItem) (lastItem.children as Lex[]).push(list);
        else parentItems.push(listItemNode([list], 1));
      } else {
        roots.push(list);
      }
      top = { level, list };
      stack.push(top);
    } else if (top.list.listType !== listType) {
      // Same depth but the marker kind changed — start a sibling list.
      const list = listNode(listType);
      if (stack.length > 1) {
        const parentItems = stack[stack.length - 2]!.list.children as Lex[];
        const lastItem = parentItems[parentItems.length - 1];
        if (lastItem) (lastItem.children as Lex[]).push(list);
      } else {
        roots.push(list);
      }
      stack[stack.length - 1] = { level, list };
      top = stack[stack.length - 1]!;
    }

    const items = top.list.children as Lex[];
    items.push(listItemNode(blockChildren(block), items.length + 1));
  }

  return roots;
}

/**
 * Convert a Portable Text document into a Lexical `SerializedEditorState`.
 */
export function portableTextToLexical(doc: PortableTextDocument): SerializedEditorState {
  const children: Lex[] = [];
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
      children.push(...buildLists(run));
      continue;
    }

    const type = (block as { _type?: string })._type;
    if (type === 'block') {
      children.push(textBlockToLexical(block as PortableTextBlock));
    } else if (type === 'code') {
      children.push(codeNode(block as Record<string, unknown>));
    } else if (typeof type === 'string') {
      children.push(customBlockNode(block as Record<string, unknown>));
    }
    index += 1;
  }

  if (children.length === 0) return createEmptyEditorState();

  return {
    root: { type: 'root', version: 1, format: '', indent: 0, direction: null, children },
  } as unknown as SerializedEditorState;
}
