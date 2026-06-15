import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';

export function DropdownMenu(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>,
): React.ReactNode {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

export function DropdownMenuPortal(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>,
): React.ReactNode {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

export function DropdownMenuTrigger(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>,
): React.ReactNode {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export function DropdownMenuGroup(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>,
): React.ReactNode {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

export function DropdownMenuRadioGroup(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
): React.ReactNode {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

export function DropdownMenuSub(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>,
): React.ReactNode {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

const contentClass = css`
  z-index: 50;
  max-height: var(--radix-dropdown-menu-content-available-height);
  min-width: 8rem;
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: 0.375rem;
  background-color: var(--popover);
  padding: 0.25rem;
  color: var(--popover-foreground);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
  outline: 1px solid color-mix(in srgb, var(--foreground), transparent 90%);
`;

export function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>): React.ReactNode {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cx(contentClass, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>): React.ReactNode {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cx(contentClass, className)}
      {...props}
    />
  );
}

const itemClass = css`
  position: relative;
  display: flex;
  cursor: default;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.125rem;
  padding: 0.375rem 0.5rem;
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
  &[data-inset] {
    padding-left: 2rem;
  }
  &[data-variant='destructive'] {
    color: var(--destructive);
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

const indicatorWrapClass = css`
  pointer-events: none;
  position: absolute;
  right: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean,
  variant?: 'default' | 'destructive',
}): React.ReactNode {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cx(itemClass, className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>): React.ReactNode {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cx(itemClass, css`padding-right: 2rem;`, className)}
      checked={checked}
      {...props}
    >
      <span className={indicatorWrapClass}>
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>): React.ReactNode {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cx(itemClass, css`padding-right: 2rem;`, className)}
      {...props}
    >
      <span className={indicatorWrapClass}>
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean,
}): React.ReactNode {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cx(itemClass, className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className={css`margin-left: auto;`} />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

const labelClass = css`
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted-foreground);
  &[data-inset] {
    padding-left: 2rem;
  }
`;

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean,
}): React.ReactNode {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cx(labelClass, className)}
      {...props}
    />
  );
}

const separatorClass = css`
  margin: 0.25rem -0.25rem;
  height: 1px;
  background-color: var(--border);
`;

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>): React.ReactNode {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cx(separatorClass, className)}
      {...props}
    />
  );
}

const shortcutClass = css`
  margin-left: auto;
  font-size: 0.75rem;
  letter-spacing: 0.1em;
  color: var(--muted-foreground);
`;

export function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>): React.ReactNode {
  return <span data-slot="dropdown-menu-shortcut" className={cx(shortcutClass, className)} {...props} />;
}
