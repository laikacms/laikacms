import { css } from '@emotion/css';
import {
  defineSchema,
  type Editor,
  EditorProvider,
  PortableTextEditable,
  type RenderDecoratorFunction,
  type RenderListItemFunction,
  type RenderStyleFunction,
  useEditor,
} from '@portabletext/editor';
import { type ReactNode, useEffect, useRef } from 'react';

import type { PortableTextDocument } from '@laikacloud/portabletext-core';

import { Toolbar } from './Toolbar';

/**
 * The full schema we hand to `@portabletext/editor`. Mirrors the constructs
 * the mappers know about so anything decoded from a stored value renders
 * cleanly in the editor.
 */
const schema = defineSchema({
  decorators: [
    { name: 'strong' },
    { name: 'em' },
    { name: 'underline' },
    { name: 'strike-through' },
    { name: 'code' },
    { name: 'sub' },
    { name: 'sup' },
    { name: 'highlight' },
  ],
  styles: [
    { name: 'normal' },
    { name: 'h1' },
    { name: 'h2' },
    { name: 'h3' },
    { name: 'h4' },
    { name: 'h5' },
    { name: 'h6' },
    { name: 'blockquote' },
  ],
  lists: [
    { name: 'bullet' },
    { name: 'number' },
  ],
  annotations: [
    { name: 'link', fields: [{ name: 'href', type: 'string' }] },
  ],
  inlineObjects: [],
  blockObjects: [],
});

const wrapperCss = css`
  border: 1px solid var(--decap-richtext-border, #ddd);
  border-radius: 4px;
  background: var(--decap-richtext-bg, #fff);
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;
const editableCss = css`
  padding: 12px 16px;
  min-height: 200px;
  font-size: 15px;
  line-height: 1.55;
  outline: none;
  &:focus-visible {
    outline: 2px solid var(--decap-richtext-focus, #5b9dd9);
    outline-offset: -2px;
  }
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 0.8em 0 0.4em;
    line-height: 1.2;
  }
  h1 { font-size: 1.9em; }
  h2 { font-size: 1.55em; }
  h3 { font-size: 1.3em; }
  h4 { font-size: 1.15em; }
  h5 { font-size: 1.05em; }
  h6 { font-size: 1em; }
  blockquote {
    margin: 0.5em 0;
    padding-left: 0.8em;
    border-left: 3px solid #ccc;
    color: #555;
  }
  ul,
  ol {
    padding-left: 1.4em;
  }
`;

const renderStyle: RenderStyleFunction = ({ schemaType, children }) => {
  switch (schemaType.value) {
    case 'h1':
      return <h1>{children}</h1>;
    case 'h2':
      return <h2>{children}</h2>;
    case 'h3':
      return <h3>{children}</h3>;
    case 'h4':
      return <h4>{children}</h4>;
    case 'h5':
      return <h5>{children}</h5>;
    case 'h6':
      return <h6>{children}</h6>;
    case 'blockquote':
      return <blockquote>{children}</blockquote>;
    default:
      return <>{children}</>;
  }
};

const renderDecorator: RenderDecoratorFunction = ({ value, children }) => {
  switch (value) {
    case 'strong':
      return <strong>{children}</strong>;
    case 'em':
      return <em>{children}</em>;
    case 'underline':
      return <u>{children}</u>;
    case 'strike-through':
      return <s>{children}</s>;
    case 'code':
      return <code>{children}</code>;
    case 'sub':
      return <sub>{children}</sub>;
    case 'sup':
      return <sup>{children}</sup>;
    case 'highlight':
      return <mark>{children}</mark>;
    default:
      return <>{children}</>;
  }
};

const renderListItem: RenderListItemFunction = ({ children }) => <li>{children}</li>;

interface PortableTextEditorViewProps {
  /** Initial document loaded into the editor. */
  initialValue: PortableTextDocument;
  /** Called with the canonical PT whenever the editor's document changes. */
  onChange: (value: PortableTextDocument) => void;
  /** Optional placeholder shown when the document is empty. */
  placeholder?: ReactNode;
}

/**
 * The Decap widget mounts this view inside its control. It owns the
 * `EditorProvider`, subscribes to the editor's `mutation` event stream
 * to mirror snapshots upward, and renders a minimal toolbar above the
 * editable surface.
 */
export function PortableTextEditorView({
  initialValue,
  onChange,
  placeholder,
}: PortableTextEditorViewProps): ReactNode {
  return (
    <EditorProvider
      initialConfig={{
        schemaDefinition: schema,
        initialValue: initialValue as unknown as Parameters<typeof EditorProvider>[0]['initialConfig']['initialValue'],
      }}
    >
      <ChangeBridge onChange={onChange} />
      <div className={wrapperCss}>
        <Toolbar />
        <PortableTextEditable
          className={editableCss}
          renderStyle={renderStyle}
          renderDecorator={renderDecorator}
          renderListItem={renderListItem}
          renderPlaceholder={placeholder ? () => <>{placeholder}</> : undefined}
        />
      </div>
    </EditorProvider>
  );
}

/**
 * Subscribes to the editor's mutation stream and forwards the canonical
 * Portable Text snapshot upward. Lives inside `EditorProvider` so it can
 * use the `useEditor` hook.
 */
function ChangeBridge({
  onChange,
}: {
  onChange: (value: PortableTextDocument) => void,
}): null {
  const editor = useEditor();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const subscription = editor.on('mutation', () => {
      const snapshot = readSnapshot(editor);
      if (snapshot) onChangeRef.current(snapshot);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [editor]);

  return null;
}

function readSnapshot(editor: Editor): PortableTextDocument | null {
  const snapshot = editor.getSnapshot();
  const value = (snapshot.context as { value?: unknown }).value;
  return Array.isArray(value) ? (value as PortableTextDocument) : null;
}
