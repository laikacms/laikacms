import { $createCodeNode } from '@lexical/code';
import { $createLinkNode } from '@lexical/link';
import { $createListItemNode, $createListNode, $isListItemNode, type ListNode } from '@lexical/list';
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type ElementNode,
  type LexicalNode,
  type SerializedEditorState,
} from 'lexical';

import type {
  PortableTextBlock,
  PortableTextDocument,
  PortableTextMarkDefinition,
  PortableTextSpan,
} from '@laikacloud/portabletext-core';

import { $createBlockNode } from '../blocks/BlockNode';
import { createHeadlessEditor } from '../lexical/headlessEditor';
import { decoratorsToFormat, isDecorator } from './marks';

const HEADING_STYLES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Split text on `\n` into Lexical text nodes interleaved with line breaks. */
function inlineNodesFromText(text: string, format: number): LexicalNode[] {
  const parts = text.split('\n');
  const nodes: LexicalNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) nodes.push($createLineBreakNode());
    if (part !== '' || parts.length === 1) nodes.push($createTextNode(part).setFormat(format));
  });
  return nodes;
}

function isSpan(child: unknown): child is PortableTextSpan {
  return !!child && typeof child === 'object' && (child as { _type?: string })._type === 'span';
}

/** Convert one span into inline Lexical nodes (a link node, or bare text nodes). */
function spanToInline(span: PortableTextSpan, markDefs: PortableTextMarkDefinition[]): LexicalNode[] {
  const marks = span.marks ?? [];
  const format = decoratorsToFormat(marks.filter(isDecorator));
  const inline = inlineNodesFromText(span.text ?? '', format);

  const annotationKey = marks.find(mark => !isDecorator(mark));
  if (annotationKey) {
    const def = markDefs.find(markDef => markDef._key === annotationKey);
    if (def && def._type === 'link' && typeof def.href === 'string') {
      const link = $createLinkNode(def.href, {
        rel: typeof def.rel === 'string' ? def.rel : null,
        target: typeof def.target === 'string' ? def.target : null,
        title: typeof def.title === 'string' ? def.title : null,
      });
      link.append(...inline);
      return [link];
    }
  }
  return inline;
}

/** Inline children of a text block. */
function blockChildren(block: PortableTextBlock): LexicalNode[] {
  const markDefs = block.markDefs ?? [];
  const children: LexicalNode[] = [];
  for (const child of block.children ?? []) {
    if (isSpan(child)) children.push(...spanToInline(child, markDefs));
  }
  return children;
}

/** Convert a non-list text block to its Lexical element node. */
function textBlockToLexical(block: PortableTextBlock): ElementNode {
  const style = block.style ?? 'normal';
  const element = style === 'blockquote'
    ? $createQuoteNode()
    : HEADING_STYLES.has(style)
    ? $createHeadingNode(style as HeadingTagType)
    : $createParagraphNode();
  element.append(...blockChildren(block));
  return element;
}

/** Convert a code block (`{_type:'code', code, language}`) to a Lexical code node. */
function codeBlockToLexical(obj: Record<string, unknown>): ElementNode {
  const code = typeof obj.code === 'string' ? obj.code : '';
  const language = typeof obj.language === 'string' ? obj.language : undefined;
  const node = $createCodeNode(language);
  node.append(...inlineNodesFromText(code, 0));
  return node;
}

/** Convert an arbitrary custom object to a Lexical BlockNode. */
function customBlockToLexical(obj: Record<string, unknown>): LexicalNode {
  const { _type, _key, ...data } = obj;
  void _key;
  return $createBlockNode(String(_type), data);
}

function isListBlock(value: unknown): value is PortableTextBlock {
  return (
    !!value
    && typeof value === 'object'
    && (value as { _type?: string })._type === 'block'
    && typeof (value as { listItem?: unknown }).listItem === 'string'
  );
}

/**
 * Group a run of consecutive Portable Text list blocks into nested Lexical
 * lists, using each block's 1-based `level`.
 */
function buildLists(run: PortableTextBlock[]): ListNode[] {
  const roots: ListNode[] = [];
  const stack: Array<{ level: number, list: ListNode }> = [];

  for (const block of run) {
    const level = typeof block.level === 'number' && block.level > 0 ? block.level : 1;
    const listType = block.listItem === 'number' ? 'number' : 'bullet';

    while (stack.length > 0 && stack[stack.length - 1]!.level > level) stack.pop();

    let top = stack[stack.length - 1];
    if (!top || top.level < level) {
      const list = $createListNode(listType);
      if (top) {
        const lastItem = top.list.getLastChild();
        if ($isListItemNode(lastItem)) {
          lastItem.append(list);
        } else {
          const item = $createListItemNode();
          item.append(list);
          top.list.append(item);
        }
      } else {
        roots.push(list);
      }
      top = { level, list };
      stack.push(top);
    } else if (top.list.getListType() !== listType) {
      // Same depth but the marker kind changed — start a sibling list.
      const list = $createListNode(listType);
      if (stack.length > 1) {
        const lastItem = stack[stack.length - 2]!.list.getLastChild();
        if ($isListItemNode(lastItem)) lastItem.append(list);
      } else {
        roots.push(list);
      }
      stack[stack.length - 1] = { level, list };
      top = stack[stack.length - 1]!;
    }

    const item = $createListItemNode();
    item.append(...blockChildren(block));
    top.list.append(item);
  }

  return roots;
}

/**
 * Convert a Portable Text document into a Lexical `SerializedEditorState`.
 *
 * Builds the document inside a headless Lexical editor using the node `$`-API
 * and serializes via `EditorState.toJSON()`, so the output is whatever Lexical
 * itself produces — no hand-authored serialized-node shapes.
 */
export function portableTextToLexical(doc: PortableTextDocument): SerializedEditorState {
  const editor = createHeadlessEditor();

  editor.update(
    () => {
      const root = $getRoot();
      root.clear();

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
          for (const list of buildLists(run)) root.append(list);
          continue;
        }

        const type = (block as { _type?: string })._type;
        if (type === 'block') {
          root.append(textBlockToLexical(block as PortableTextBlock));
        } else if (type === 'code') {
          root.append(codeBlockToLexical(block as Record<string, unknown>));
        } else if (typeof type === 'string') {
          root.append(customBlockToLexical(block as Record<string, unknown>));
        }
        index += 1;
      }

      // Lexical requires a non-empty root; mirror an empty document as a single
      // empty paragraph (the canonical empty editor state).
      if (root.getChildrenSize() === 0) root.append($createParagraphNode());
    },
    { discrete: true },
  );

  return editor.getEditorState().toJSON();
}
