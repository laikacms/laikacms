import { ContentEditable as LexicalContentEditable } from '@lexical/react/LexicalContentEditable';
import type { ReactNode } from 'react';

import { css, cx } from '../ui/_styled';

interface Props {
  placeholder: string;
  className?: string;
  placeholderClassName?: string;
}

const rootClass = css`
  position: relative;
  display: block;
  min-height: 18rem;
  overflow: auto;
  padding: 0.5rem 1rem;
  &:focus {
    outline: none;
  }
`;

const placeholderClass = css`
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  color: var(--muted-foreground);
  padding: 0.5rem 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
`;

export function ContentEditable({
  placeholder,
  className,
  placeholderClassName,
}: Props): ReactNode {
  return (
    <LexicalContentEditable
      className={cx('ContentEditable__root', rootClass, className)}
      aria-placeholder={placeholder}
      placeholder={<div className={cx(placeholderClass, placeholderClassName)}>{placeholder}</div>}
    />
  );
}
