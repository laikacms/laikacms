import { css } from '@emotion/css';
import { useEditor, useEditorSelector } from '@portabletext/editor';
import * as selectors from '@portabletext/editor/selectors';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

const toolbarCss = css`
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 6px;
  border-bottom: 1px solid var(--decap-richtext-border, #ddd);
  background: var(--decap-richtext-toolbar-bg, #fafafa);
`;
const buttonCss = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 4px;
  color: #333;
  cursor: pointer;
  &:hover {
    background: rgba(0, 0, 0, 0.06);
  }
  &[data-active='true'] {
    background: rgba(0, 0, 0, 0.1);
    border-color: rgba(0, 0, 0, 0.15);
  }
`;
const dividerCss = css`
  width: 1px;
  background: #ddd;
  margin: 4px 4px;
`;

interface DecoratorButtonProps {
  decorator: string;
  icon: ReactNode;
  label: string;
}

function DecoratorButton({ decorator, icon, label }: DecoratorButtonProps): ReactNode {
  const editor = useEditor();
  const active = useEditorSelector(editor, selectors.isActiveDecorator(decorator));
  return (
    <button
      type="button"
      className={buttonCss}
      data-active={active ? 'true' : 'false'}
      title={label}
      aria-label={label}
      onMouseDown={(event: MouseEvent) => {
        event.preventDefault();
        editor.send({ type: 'decorator.toggle', decorator });
      }}
    >
      {icon}
    </button>
  );
}

interface StyleButtonProps {
  style: string;
  icon: ReactNode;
  label: string;
}

function StyleButton({ style, icon, label }: StyleButtonProps): ReactNode {
  const editor = useEditor();
  const active = useEditorSelector(editor, selectors.isActiveStyle(style));
  return (
    <button
      type="button"
      className={buttonCss}
      data-active={active ? 'true' : 'false'}
      title={label}
      aria-label={label}
      onMouseDown={(event: MouseEvent) => {
        event.preventDefault();
        editor.send({ type: 'style.toggle', style });
      }}
    >
      {icon}
    </button>
  );
}

interface ListButtonProps {
  list: string;
  icon: ReactNode;
  label: string;
}

function ListButton({ list, icon, label }: ListButtonProps): ReactNode {
  const editor = useEditor();
  const active = useEditorSelector(editor, selectors.isActiveListItem(list));
  return (
    <button
      type="button"
      className={buttonCss}
      data-active={active ? 'true' : 'false'}
      title={label}
      aria-label={label}
      onMouseDown={(event: MouseEvent) => {
        event.preventDefault();
        editor.send({ type: 'list item.toggle', listItem: list });
      }}
    >
      {icon}
    </button>
  );
}

export function Toolbar(): ReactNode {
  return (
    <div className={toolbarCss}>
      <StyleButton style="h1" icon={<Heading1 size={16} />} label="Heading 1" />
      <StyleButton style="h2" icon={<Heading2 size={16} />} label="Heading 2" />
      <StyleButton style="h3" icon={<Heading3 size={16} />} label="Heading 3" />
      <StyleButton style="blockquote" icon={<Quote size={16} />} label="Quote" />
      <span className={dividerCss} />
      <DecoratorButton decorator="strong" icon={<Bold size={16} />} label="Bold" />
      <DecoratorButton decorator="em" icon={<Italic size={16} />} label="Italic" />
      <DecoratorButton decorator="underline" icon={<Underline size={16} />} label="Underline" />
      <DecoratorButton decorator="strike-through" icon={<Strikethrough size={16} />} label="Strikethrough" />
      <DecoratorButton decorator="code" icon={<Code size={16} />} label="Inline code" />
      <span className={dividerCss} />
      <ListButton list="bullet" icon={<List size={16} />} label="Bullet list" />
      <ListButton list="number" icon={<ListOrdered size={16} />} label="Numbered list" />
    </div>
  );
}
