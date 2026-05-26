import type { SerializedEditorState } from 'lexical';

/**
 * A fresh, empty Lexical editor state: a root containing a single empty
 * paragraph. Cast loosely because the exact serialized-node shape carries
 * version-specific required fields we don't want to track by hand.
 */
export function createEmptyEditorState(): SerializedEditorState {
  return {
    root: {
      type: 'root',
      version: 1,
      format: '',
      indent: 0,
      direction: null,
      children: [
        {
          type: 'paragraph',
          version: 1,
          format: '',
          indent: 0,
          direction: null,
          textFormat: 0,
          textStyle: '',
          children: [],
        },
      ],
    },
  } as unknown as SerializedEditorState;
}
