import { Tabs as TabsPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx, variants } from './_styled';

const tabsClass = css`
  display: flex;
  gap: 0.5rem;
  &[data-orientation='horizontal'] {
    flex-direction: column;
  }
`;

export function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>): React.ReactNode {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cx(tabsClass, className)}
      {...props}
    />
  );
}

const listBase = css`
  display: inline-flex;
  width: fit-content;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  padding: 3px;
  color: var(--muted-foreground);
`;

export const tabsListVariants = variants(listBase, {
  variants: {
    variant: {
      default: css`
        background-color: var(--muted);
      `,
      line: css`
        gap: 0.25rem;
        background-color: transparent;
        border-radius: 0;
      `,
    },
  },
  defaultVariants: { variant: 'default' },
});

export function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: 'default' | 'line',
}): React.ReactNode {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={tabsListVariants({ variant, className })}
      {...props}
    />
  );
}

const triggerClass = css`
  position: relative;
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  color: color-mix(in srgb, var(--foreground), transparent 40%);
  transition: all 0.15s;
  &:hover {
    color: var(--foreground);
  }
  &:focus-visible {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring), transparent 50%);
  }
  &:disabled {
    pointer-events: none;
    opacity: 0.5;
  }
  &[data-state='active'] {
    background-color: var(--background);
    color: var(--foreground);
    box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  }
  & svg {
    pointer-events: none;
    flex-shrink: 0;
  }
  & svg:not([class*='size-']) {
    width: 1rem;
    height: 1rem;
  }
`;

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>): React.ReactNode {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cx(triggerClass, className)}
      {...props}
    />
  );
}

const contentClass = css`
  flex: 1;
  font-size: 0.875rem;
  outline: none;
`;

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>): React.ReactNode {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cx(contentClass, className)}
      {...props}
    />
  );
}
