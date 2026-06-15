import { $createParagraphNode, $getRoot, type SerializedEditorState } from 'lexical';

import { createHeadlessEditor } from '../lexical/headlessEditor';

/**
 * A fresh, empty Lexical editor state: a root containing a single empty
 * paragraph. Built through a headless Lexical editor so the serialized shape
 * (and its version-specific required fields) comes straight from Lexical
 * rather than being hand-authored.
 */
export function createEmptyEditorState(): SerializedEditorState {
  const editor = createHeadlessEditor();
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      root.append($createParagraphNode());
    },
    { discrete: true },
  );
  return editor.getEditorState().toJSON();
}
