import { Popover as PopoverPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';

export function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>): React.ReactNode {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

export function PopoverTrigger(
  props: React.ComponentProps<typeof PopoverPrimitive.Trigger>,
): React.ReactNode {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export function PopoverAnchor(
  props: React.ComponentProps<typeof PopoverPrimitive.Anchor>,
): React.ReactNode {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

const contentClass = css`
  z-index: 50;
  display: flex;
  width: 18rem;
  flex-direction: column;
  gap: 1rem;
  border-radius: 0.375rem;
  background-color: var(--popover);
  padding: 1rem;
  font-size: 0.875rem;
  color: var(--popover-foreground);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
  outline: 1px solid color-mix(in srgb, var(--foreground), transparent 90%);
`;

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>): React.ReactNode {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cx(contentClass, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

const headerClass = css`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.875rem;
`;

export function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
  return <div data-slot="popover-header" className={cx(headerClass, className)} {...props} />;
}

const titleClass = css`
  font-weight: 500;
`;

export function PopoverTitle({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
  return <div data-slot="popover-title" className={cx(titleClass, className)} {...props} />;
}

const descriptionClass = css`
  color: var(--muted-foreground);
`;

export function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<'p'>): React.ReactNode {
  return <p data-slot="popover-description" className={cx(descriptionClass, className)} {...props} />;
}
