import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';

export function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>): React.ReactNode {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

export function SelectValue(
  props: React.ComponentProps<typeof SelectPrimitive.Value>,
): React.ReactNode {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

const groupClass = css`
  padding: 0.25rem;
`;

export function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>): React.ReactNode {
  return <SelectPrimitive.Group data-slot="select-group" className={cx(groupClass, className)} {...props} />;
}

const triggerClass = css`
  display: flex;
  width: fit-content;
  align-items: center;
  justify-content: space-between;
  gap: 0.375rem;
  border-radius: 0.375rem;
  border: 1px solid var(--input);
  background-color: transparent;
  padding: 0.5rem 0.5rem 0.5rem 0.625rem;
  font-size: 0.875rem;
  white-space: nowrap;
  outline: none;
  cursor: pointer;
  transition: color 0.15s, box-shadow 0.15s;
  &:focus-visible {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring), transparent 50%);
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  &[data-placeholder] {
    color: var(--muted-foreground);
  }
  &[data-size='default'] {
    height: 2.25rem;
  }
  &[data-size='sm'] {
    height: 2rem;
  }
  & svg {
    pointer-events: none;
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
  }
`;

export function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default',
}): React.ReactNode {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cx(triggerClass, className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className={css`color: var(--muted-foreground);`} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

const contentClass = css`
  position: relative;
  z-index: 50;
  max-height: var(--radix-select-content-available-height);
  min-width: 9rem;
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: 0.375rem;
  background-color: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
  outline: 1px solid color-mix(in srgb, var(--foreground), transparent 90%);
`;

const scrollButtonClass = css`
  z-index: 10;
  display: flex;
  cursor: default;
  align-items: center;
  justify-content: center;
  background-color: var(--popover);
  padding: 0.25rem 0;
  & svg:not([class*='size-']) {
    width: 1rem;
    height: 1rem;
  }
`;

export function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>): React.ReactNode {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cx(scrollButtonClass, className)}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

export function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>): React.ReactNode {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cx(scrollButtonClass, className)}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export function SelectContent({
  className,
  children,
  position = 'item-aligned',
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>): React.ReactNode {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cx(contentClass, className)}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport data-position={position}>{children}</SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

const selectLabelClass = css`
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
`;

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>): React.ReactNode {
  return <SelectPrimitive.Label data-slot="select-label" className={cx(selectLabelClass, className)} {...props} />;
}

const selectItemClass = css`
  position: relative;
  display: flex;
  width: 100%;
  cursor: default;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.125rem;
  padding: 0.375rem 2rem 0.375rem 0.5rem;
  font-size: 0.875rem;
  outline: none;
  user-select: none;
  &:focus,
  &[data-highlighted] {
    background-color: var(--accent);
    color: var(--accent-foreground);
  }
  &[data-disabled] {
    pointer-events: none;
    opacity: 0.5;
  }
  & svg {
    pointer-events: none;
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
  }
`;

const selectItemIndicatorClass = css`
  pointer-events: none;
  position: absolute;
  right: 0.5rem;
  display: flex;
  width: 1rem;
  height: 1rem;
  align-items: center;
  justify-content: center;
`;

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>): React.ReactNode {
  return (
    <SelectPrimitive.Item data-slot="select-item" className={cx(selectItemClass, className)} {...props}>
      <span className={selectItemIndicatorClass}>
        <SelectPrimitive.ItemIndicator>
          <CheckIcon />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

const selectSeparatorClass = css`
  pointer-events: none;
  margin: 0.25rem -0.25rem;
  height: 1px;
  background-color: var(--border);
`;

export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>): React.ReactNode {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cx(selectSeparatorClass, className)}
      {...props}
    />
  );
}
