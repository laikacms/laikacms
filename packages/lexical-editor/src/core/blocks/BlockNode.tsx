import {
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import type { ComponentType, ReactNode } from 'react';

import type { BlockData } from './types';

/** Lexical's `_type` discriminator for custom blocks. */
export const BLOCK_NODE_TYPE = 'decap-block';

/** Serialized form of a {@link BlockNode}. */
export type SerializedBlockNode = Spread<
  { componentId: string, data: BlockData },
  SerializedLexicalNode
>;

/** Props passed to a registered block-renderer component. */
export interface BlockComponentProps {
  componentId: string;
  data: BlockData;
  nodeKey: NodeKey;
}

/**
 * The block UI lives in the widget package (emotion-styled), not in core.
 * The widget registers its renderer here; `decorate()` uses it.
 */
let blockComponent: ComponentType<BlockComponentProps> | null = null;

/** Register the React component used to render custom blocks in the editor. */
export function registerBlockComponent(component: ComponentType<BlockComponentProps>): void {
  blockComponent = component;
}

/**
 * A Lexical `DecoratorNode` embedding a custom, data-carrying block
 * (shortcodes, embeds, code blocks, …) identified by `componentId`.
 */
export class BlockNode extends DecoratorNode<ReactNode> {
  __componentId: string;
  __data: BlockData;

  constructor(componentId: string, data: BlockData = {}, key?: NodeKey) {
    super(key);
    this.__componentId = componentId;
    this.__data = data;
  }

  static getType(): string {
    return BLOCK_NODE_TYPE;
  }

  static clone(node: BlockNode): BlockNode {
    return new BlockNode(node.__componentId, node.__data, node.__key);
  }

  static importJSON(serialized: SerializedBlockNode): BlockNode {
    return $createBlockNode(serialized.componentId, serialized.data);
  }

  exportJSON(): SerializedBlockNode {
    return {
      ...super.exportJSON(),
      type: BLOCK_NODE_TYPE,
      version: 1,
      componentId: this.__componentId,
      data: this.__data,
    };
  }

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    const div = document.createElement('div');
    div.style.display = 'contents';
    return div;
  }

  updateDOM(): false {
    return false;
  }

  getComponentId(): string {
    return this.getLatest().__componentId;
  }

  getData(): BlockData {
    return this.getLatest().__data;
  }

  setData(data: BlockData): void {
    this.getWritable().__data = data;
  }

  isInline(): false {
    return false;
  }

  decorate(): ReactNode {
    if (!blockComponent) return null;
    const Component = blockComponent;
    return <Component componentId={this.getComponentId()} data={this.getData()} nodeKey={this.getKey()} />;
  }
}

/** Create a {@link BlockNode}. */
export function $createBlockNode(componentId: string, data: BlockData = {}): BlockNode {
  return new BlockNode(componentId, data);
}

/** Type guard for {@link BlockNode}. */
export function $isBlockNode(node: LexicalNode | null | undefined): node is BlockNode {
  return node instanceof BlockNode;
}
