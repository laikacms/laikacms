import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';

const rootClass = css`
  position: relative;
`;

const viewportClass = css`
  width: 100%;
  height: 100%;
  border-radius: inherit;
  outline: none;
`;

const scrollbarClass = css`
  display: flex;
  touch-action: none;
  padding: 1px;
  user-select: none;
  transition: background-color 0.15s;
  &[data-orientation='vertical'] {
    height: 100%;
    width: 0.625rem;
    border-left: 1px solid transparent;
  }
  &[data-orientation='horizontal'] {
    height: 0.625rem;
    flex-direction: column;
    border-top: 1px solid transparent;
  }
`;

const thumbClass = css`
  position: relative;
  flex: 1;
  border-radius: 9999px;
  background-color: var(--border);
`;

export function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>): React.ReactNode {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cx(scrollbarClass, className)}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb data-slot="scroll-area-thumb" className={thumbClass} />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>): React.ReactNode {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cx(rootClass, className)} {...props}>
      <ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport" className={viewportClass}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
