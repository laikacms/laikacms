import type { SerializedEditorState } from 'lexical';
import { type ReactNode, useMemo, useRef } from 'react';

import {
  createLexicalRichtextValue as createRichtextValue,
  LexicalRichtextValue as RichtextValue,
} from 'decap-cms-lexical-core';

import { Editor } from '../editor/Editor';
import { EditorGlobalStyles } from '../editor/themes/global-styles';
import './register-formats';

interface DecapField {
  format?: string;
  placeholder?: string;
  [key: string]: unknown;
}

interface LexicalControlProps {
  /** Stored field value: either a raw string or a live `RichtextValue`. */
  value?: string | RichtextValue;
  /** Decap field-config object — we read `format` and `placeholder` here. */
  field: DecapField;
  /** Fires whenever the editor state changes — receives the same proxy each time. */
  onChange: (value: RichtextValue) => void;
  /** Decap's optional id prop for the labelled control. */
  forID?: string;
  /** Wrapper class supplied by Decap. */
  classNameWrapper?: string;
  isDisabled?: boolean;
}

/**
 * Decap CMS control component for the Lexical widget.
 *
 * Wraps the shadcn-editor port; threads the stored value through a
 * `RichtextValue` proxy so the expensive serialized string is produced
 * lazily, only when Decap reads it at file-write time.
 */
export function LexicalControl({
  value,
  field,
  onChange,
  forID,
  classNameWrapper,
  isDisabled,
}: LexicalControlProps): ReactNode {
  const hint = typeof field.format === 'string' ? field.format : undefined;

  // Hold a stable RichtextValue across renders. The proxy *itself* doesn't
  // change identity — only its `editorState` mutates as the user types.
  const proxyRef = useRef<RichtextValue | null>(null);
  if (proxyRef.current === null) {
    proxyRef.current = value instanceof RichtextValue
      ? value
      : createRichtextValue(typeof value === 'string' ? value : '', { hint });
  }
  const proxy = proxyRef.current;

  const initialState = useMemo<SerializedEditorState | undefined>(
    () => proxy.editorState,
    // Only compute once — re-mounting with a fresh state would lose user edits.
    [],
  );

  return (
    <div id={forID} className={classNameWrapper}>
      <EditorGlobalStyles />
      <Editor
        editorSerializedState={initialState}
        onSerializedChange={state => {
          proxy.setEditorState(state);
          onChange(proxy);
        }}
      />
      {isDisabled ? <div aria-hidden style={{ position: 'absolute', inset: 0 }} /> : null}
    </div>
  );
}
