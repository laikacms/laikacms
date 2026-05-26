import { createHeadlessEditor as createLexicalHeadlessEditor } from '@lexical/headless';
import type { Klass, LexicalEditor, LexicalNode } from 'lexical';

import { DEFAULT_NODES } from './nodes';

/**
 * Create a headless (no-DOM) Lexical editor with {@link DEFAULT_NODES} plus any
 * extra nodes. Used to run Lexical transforms and serialization outside the UI.
 */
export function createHeadlessEditor(
  extraNodes: ReadonlyArray<Klass<LexicalNode>> = [],
): LexicalEditor {
  return createLexicalHeadlessEditor({
    namespace: 'decap-cms-lexical',
    nodes: [...DEFAULT_NODES, ...extraNodes],
    onError(error) {
      throw error;
    },
  });
}

let singleton: LexicalEditor | null = null;

/** A lazily-created shared headless editor for one-off serialization work. */
export function getHeadlessEditor(): LexicalEditor {
  if (!singleton) singleton = createHeadlessEditor();
  return singleton;
}
