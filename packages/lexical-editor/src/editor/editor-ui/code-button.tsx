import { $isCodeNode } from '@lexical/code';
import { $getNearestNodeFromDOMNode, $getSelection, $setSelection, type LexicalEditor } from 'lexical';
import { CircleCheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';

import { useDebounce } from '../editor-hooks/use-debounce';
import { css } from '../ui/_styled';

interface Props {
  editor: LexicalEditor;
  getCodeDOMNode: () => HTMLElement | null;
}

const buttonClass = css`
  display: flex;
  flex-shrink: 0;
  cursor: pointer;
  align-items: center;
  border-radius: 0.25rem;
  border: 1px solid transparent;
  background: none;
  padding: 0.25rem;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--foreground), transparent 50%);
  & svg {
    width: 1rem;
    height: 1rem;
  }
`;

export function CopyButton({ editor, getCodeDOMNode }: Props) {
  const [isCopyCompleted, setCopyCompleted] = useState<boolean>(false);
  const removeSuccessIcon = useDebounce(() => setCopyCompleted(false), 1000);

  async function handleClick(): Promise<void> {
    const codeDOMNode = getCodeDOMNode();
    if (!codeDOMNode) return;

    let content = '';
    editor.update(() => {
      const codeNode = $getNearestNodeFromDOMNode(codeDOMNode);
      if ($isCodeNode(codeNode)) content = codeNode.getTextContent();
      const selection = $getSelection();
      $setSelection(selection);
    });

    try {
      await navigator.clipboard.writeText(content);
      setCopyCompleted(true);
      removeSuccessIcon();
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }

  return (
    <button className={buttonClass} onClick={handleClick} aria-label="copy">
      {isCopyCompleted ? <CircleCheckIcon /> : <CopyIcon />}
    </button>
  );
}
