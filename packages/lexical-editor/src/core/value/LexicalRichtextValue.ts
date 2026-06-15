import { RichtextValue, type RichtextValueOptions } from '@laikacloud/portabletext-core';
import type { SerializedEditorState } from 'lexical';

import { lexicalToPortableText } from '../bridge/lexicalToPortableText';
import { portableTextToLexical } from '../bridge/portableTextToLexical';
import type { EditorSchema } from '../schema/schema';

/**
 * Options for {@link LexicalRichtextValue}. Extends the base value options with
 * an optional schema that restricts which decorators/styles/lists/links survive
 * when deriving Portable Text from the live editor state.
 */
export interface LexicalRichtextValueOptions extends RichtextValueOptions {
  schema?: EditorSchema;
}

/**
 * A {@link RichtextValue} bound to a live Lexical editor.
 *
 * Extends the editor-agnostic proxy with a Lexical `editorState` cache and
 * derives the canonical Portable Text whenever the state changes. The
 * Lexical widget mirrors `editorState` between this value and the editor;
 * everything else (output mapper, memoised toString) lives on the base
 * class.
 */
export class LexicalRichtextValue extends RichtextValue {
  /** Live Lexical editor state; replaced by the editor as the user types. */
  editorState: SerializedEditorState;

  /** Schema restricting which marks/blocks survive serialization, if any. */
  readonly schema?: EditorSchema;

  constructor(raw: string, options: LexicalRichtextValueOptions = {}) {
    super(raw, options);
    this.schema = options.schema;
    this.editorState = portableTextToLexical(this.portableText);
  }

  /**
   * Replace the live Lexical state. Updates the canonical Portable Text and
   * invalidates the memoised serialisation on the base class.
   */
  setEditorState(state: SerializedEditorState): void {
    this.editorState = state;
    this.setPortableText(lexicalToPortableText(state, { schema: this.schema }));
  }
}

/** Create a {@link LexicalRichtextValue} from a stored string. */
export function createLexicalRichtextValue(
  raw: string,
  options?: LexicalRichtextValueOptions,
): LexicalRichtextValue {
  return new LexicalRichtextValue(raw, options);
}
