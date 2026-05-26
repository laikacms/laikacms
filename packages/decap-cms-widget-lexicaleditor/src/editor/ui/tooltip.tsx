import { Tooltip as TooltipPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';

export function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>): React.ReactNode {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

export function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>): React.ReactNode {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

export function TooltipTrigger(
  props: React.ComponentProps<typeof TooltipPrimitive.Trigger>,
): React.ReactNode {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

const contentClass = css`
  z-index: 50;
  display: inline-flex;
  width: fit-content;
  max-width: 20rem;
  align-items: center;
  gap: 0.375rem;
  border-radius: 0.375rem;
  background-color: var(--foreground);
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  line-height: 1rem;
  color: var(--background);
`;

const arrowClass = css`
  z-index: 50;
  width: 0.625rem;
  height: 0.625rem;
  transform: translateY(calc(-50% - 2px)) rotate(45deg);
  border-radius: 2px;
  background-color: var(--foreground);
  fill: var(--foreground);
`;

export function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>): React.ReactNode {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cx(contentClass, className)}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className={arrowClass} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
