/**
 * Toolbar context — exposes the editor instance and selection state to the
 * toolbar plugins. Ported from shadcn-editor; their idiom is that `ToolbarContext`
 * itself is a component you render with the context values as props.
 */
import type { LexicalEditor } from 'lexical';
import { createContext, type JSX, type ReactNode, useContext } from 'react';

type ShowModalFn = (title: string, render: (onClose: () => void) => JSX.Element) => void;

interface ToolbarContextValue {
  activeEditor: LexicalEditor;
  blockType: string;
  setBlockType: (blockType: string) => void;
  showModal: ShowModalFn;
  $updateToolbar: () => void;
}

const InternalToolbarContext = createContext<ToolbarContextValue | null>(null);

export interface ToolbarContextProps extends ToolbarContextValue {
  children?: ReactNode;
}

/** Provider component matching shadcn-editor's `<ToolbarContext value... />` shape. */
export function ToolbarContext({ children, ...value }: ToolbarContextProps): ReactNode {
  return <InternalToolbarContext.Provider value={value}>{children}</InternalToolbarContext.Provider>;
}

/** Read the toolbar context. Throws if used outside a `<ToolbarContext>`. */
export function useToolbarContext(): ToolbarContextValue {
  const value = useContext(InternalToolbarContext);
  if (!value) throw new Error('useToolbarContext must be used inside a <ToolbarContext>');
  return value;
}
