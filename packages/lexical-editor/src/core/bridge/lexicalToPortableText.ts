import { $isCodeNode } from '@lexical/code';
import { $isLinkNode } from '@lexical/link';
import { $isListItemNode, $isListNode, type ListNode } from '@lexical/list';
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import {
  $getRoot,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type SerializedEditorState,
} from 'lexical';

import {
  createKeyGenerator,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextMarkDefinition,
  type PortableTextSpan,
} from '@laikacloud/portabletext-core';

import { $isBlockNode } from '../blocks/BlockNode';
import { createHeadlessEditor } from '../lexical/headlessEditor';
import { DEFAULT_NODES } from '../lexical/nodes';
import {
  type EditorSchema,
  schemaDecoratorNames,
  schemaHasAnnotation,
  schemaListNames,
  schemaStyleNames,
} from '../schema/schema';
import { formatToDecorators } from './marks';

interface KeyGens {
  block: () => string;
  span: () => string;
  mark: () => string;
}

/**
 * Schema-derived allow-lists. An `undefined` set means "allow everything" (no
 * schema supplied); `allowLink` gates whether link annotations are emitted.
 */
interface Allow {
  decorators?: ReadonlySet<string>;
  styles?: ReadonlySet<string>;
  lists?: ReadonlySet<string>;
  allowLink: boolean;
}

const ALLOW_ALL: Allow = { allowLink: true };

function allowFromSchema(schema: EditorSchema | undefined): Allow {
  if (!schema) return ALLOW_ALL;
  return {
    decorators: schemaDecoratorNames(schema),
    styles: schemaStyleNames(schema),
    lists: schemaListNames(schema),
    allowLink: schemaHasAnnotation(schema, 'link'),
  };
}

/** Options for {@link lexicalToPortableText}. */
export interface LexicalToPortableTextOptions {
  /** Restrict emitted decorators/styles/lists/links to this schema's vocabulary. */
  schema?: EditorSchema;
}

/**
 * Collapse a list of inline Lexical nodes (text, line break, tab, link) into
 * Portable Text spans, appending any discovered link annotations to `markDefs`.
 */
function collectSpans(
  nodes: LexicalNode[],
  markDefs: PortableTextMarkDefinition[],
  keys: KeyGens,
  allow: Allow,
): PortableTextSpan[] {
  const spans: PortableTextSpan[] = [];
  let current: { text: string, marks: string[], marksKey: string } | null = null;

  const flush = (): void => {
    if (!current) return;
    spans.push({ _type: 'span', _key: keys.span(), text: current.text, marks: current.marks });
    current = null;
  };

  const emit = (text: string, format: number, linkKey: string | undefined): void => {
    const decorators = formatToDecorators(format, allow.decorators);
    const marks = linkKey ? [...decorators, linkKey] : decorators;
    const marksKey = marks.join(' ');
    if (current && current.marksKey === marksKey) {
      current.text += text;
    } else {
      flush();
      current = { text, marks, marksKey };
    }
  };

  const emitBreak = (linkKey: string | undefined): void => {
    if (current) {
      current.text += '\n';
    } else {
      const marks = linkKey ? [linkKey] : [];
      current = { text: '\n', marks, marksKey: marks.join(' ') };
    }
  };

  const walk = (list: LexicalNode[], linkKey: string | undefined): void => {
    for (const node of list) {
      if ($isLineBreakNode(node)) {
        emitBreak(linkKey);
      } else if ($isLinkNode(node)) {
        // `$isLinkNode` also matches AutoLinkNode (a LinkNode subclass).
        if (!allow.allowLink) {
          // Schema forbids links: keep the text, drop the annotation.
          walk(node.getChildren(), linkKey);
          continue;
        }
        flush();
        const key = keys.mark();
        markDefs.push({ _type: 'link', _key: key, href: node.getURL() });
        walk(node.getChildren(), key);
        flush();
      } else if ($isTextNode(node)) {
        // Covers TextNode and its subclasses (TabNode -> '\t', code highlight).
        emit(node.getTextContent(), node.getFormat(), linkKey);
      }
    }
  };

  walk(nodes, undefined);
  flush();
  return spans;
}

/** Gather the plain-text content of a Lexical code node. */
function codeText(node: ElementNode): string {
  let text = '';
  for (const child of node.getChildren()) {
    if ($isLineBreakNode(child)) text += '\n';
    else if ($isTextNode(child)) text += child.getTextContent();
  }
  return text;
}

/** Flatten a Lexical list node into level-tagged Portable Text list blocks. */
function flattenList(
  node: ListNode,
  level: number,
  out: PortableTextDocument,
  keys: KeyGens,
  allow: Allow,
): void {
  const listItem = node.getListType() === 'number' ? 'number' : 'bullet';
  // When the schema forbids this list type, demote items to plain blocks.
  const listAllowed = !allow.lists || allow.lists.has(listItem);
  for (const item of node.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const children = item.getChildren();
    const nested = children.filter($isListNode);
    const inline = children.filter(child => !$isListNode(child));

    if (inline.length > 0 || nested.length === 0) {
      const markDefs: PortableTextMarkDefinition[] = [];
      const spans = collectSpans(inline, markDefs, keys, allow);
      out.push({
        _type: 'block',
        _key: keys.block(),
        style: 'normal',
        ...(listAllowed ? { listItem, level } : {}),
        markDefs,
        children: spans,
      });
    }
    for (const child of nested) flattenList(child, level + 1, out, keys, allow);
  }
}

/** Convert one non-list root node to a Portable Text block. */
function convertBlock(
  node: LexicalNode,
  keys: KeyGens,
  allow: Allow,
): PortableTextBlock | Record<string, unknown> | null {
  if ($isParagraphNode(node) || $isHeadingNode(node) || $isQuoteNode(node)) {
    const markDefs: PortableTextMarkDefinition[] = [];
    const spans = collectSpans(node.getChildren(), markDefs, keys, allow);
    const rawStyle = $isQuoteNode(node) ? 'blockquote' : $isHeadingNode(node) ? node.getTag() : 'normal';
    // Styles outside the schema fall back to plain paragraphs.
    const style = !allow.styles || allow.styles.has(rawStyle) ? rawStyle : 'normal';
    return { _type: 'block', _key: keys.block(), style, markDefs, children: spans };
  }
  if ($isCodeNode(node)) {
    return {
      _type: 'code',
      _key: keys.block(),
      code: codeText(node),
      language: node.getLanguage() ?? null,
    };
  }
  if ($isBlockNode(node)) {
    return {
      _type: node.getComponentId(),
      _key: keys.block(),
      ...node.getData(),
    };
  }
  return null;
}

// Node types the core headless editor can parse: Lexical's always-registered
// base nodes plus DEFAULT_NODES. The full editor registers extra nodes
// (mentions, emojis, embeds, layout, …) that this bridge does not map; we drop
// them before parsing so `parseEditorState` doesn't throw on an unregistered
// type — matching the previous behaviour, which silently skipped them.
const PARSEABLE_TYPES: ReadonlySet<string> = new Set<string>([
  'root',
  'text',
  'paragraph',
  'linebreak',
  'tab',
  ...DEFAULT_NODES.map(node => node.getType()),
]);

/** Recursively drop serialized children whose node type the bridge can't parse. */
function dropUnparseable(node: Record<string, any>): Record<string, any> {
  if (!Array.isArray(node.children)) return node;
  return {
    ...node,
    children: node.children
      .filter((child: { type?: string }) => !!child && PARSEABLE_TYPES.has(child.type ?? ''))
      .map(dropUnparseable),
  };
}

/**
 * Convert a Lexical `SerializedEditorState` into a Portable Text document.
 *
 * Parses the state into a real Lexical editor and reads it through the node
 * `$`-API (type guards + accessors) rather than walking raw serialized JSON.
 */
export function lexicalToPortableText(
  state: SerializedEditorState,
  options?: LexicalToPortableTextOptions,
): PortableTextDocument {
  const keys: KeyGens = {
    block: createKeyGenerator('b'),
    span: createKeyGenerator('s'),
    mark: createKeyGenerator('m'),
  };
  const allow = allowFromSchema(options?.schema);
  const out: PortableTextDocument = [];

  const editor = createHeadlessEditor();
  const root = (state as unknown as { root?: Record<string, any> }).root;
  const safe = root ? ({ ...state, root: dropUnparseable(root) } as SerializedEditorState) : state;
  const editorState = editor.parseEditorState(safe);

  editorState.read(() => {
    for (const node of $getRoot().getChildren()) {
      if ($isListNode(node)) {
        flattenList(node, 1, out, keys, allow);
        continue;
      }
      const block = convertBlock(node, keys, allow);
      if (block) out.push(block as PortableTextBlock);
    }
  });

  return out;
}
