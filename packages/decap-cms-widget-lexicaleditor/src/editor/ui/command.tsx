import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';
import * as React from 'react';

import { css, cx } from './_styled';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

const commandClass = css`
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-radius: 0.75rem;
  background-color: var(--popover);
  padding: 0.25rem;
  color: var(--popover-foreground);
`;

export function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>): React.ReactNode {
  return <CommandPrimitive data-slot="command" className={cx(commandClass, className)} {...props} />;
}

const srOnly = css`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
`;

const dialogContentClass = css`
  top: 33%;
  transform: translate(-50%, 0);
  overflow: hidden;
  padding: 0;
`;

export function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string,
  description?: string,
  className?: string,
  showCloseButton?: boolean,
}): React.ReactNode {
  return (
    <Dialog {...props}>
      <DialogHeader className={srOnly}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent className={cx(dialogContentClass, className)} showCloseButton={showCloseButton}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

const inputWrapClass = css`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2rem;
  margin: 0.25rem 0.25rem 0;
  padding: 0 0.5rem;
  border-radius: 0.5rem;
  border: 1px solid color-mix(in srgb, var(--input), transparent 70%);
  background-color: color-mix(in srgb, var(--input), transparent 70%);
  & svg {
    flex-shrink: 0;
    opacity: 0.5;
  }
`;

const inputClass = css`
  width: 100%;
  border: 0;
  background: transparent;
  font-size: 0.875rem;
  outline: none;
  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>): React.ReactNode {
  return (
    <div data-slot="command-input-wrapper" className={inputWrapClass}>
      <SearchIcon size={16} />
      <CommandPrimitive.Input data-slot="command-input" className={cx(inputClass, className)} {...props} />
    </div>
  );
}

const listClass = css`
  max-height: 18rem;
  overflow-x: hidden;
  overflow-y: auto;
  outline: none;
`;

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>): React.ReactNode {
  return <CommandPrimitive.List data-slot="command-list" className={cx(listClass, className)} {...props} />;
}

const emptyClass = css`
  padding: 1.5rem 0;
  text-align: center;
  font-size: 0.875rem;
`;

export function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>): React.ReactNode {
  return <CommandPrimitive.Empty data-slot="command-empty" className={cx(emptyClass, className)} {...props} />;
}

const groupClass = css`
  overflow: hidden;
  padding: 0.25rem;
  color: var(--foreground);
  & [cmdk-group-heading] {
    padding: 0.375rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
`;

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>): React.ReactNode {
  return <CommandPrimitive.Group data-slot="command-group" className={cx(groupClass, className)} {...props} />;
}

const separatorClass = css`
  margin: 0 -0.25rem;
  height: 1px;
  background-color: var(--border);
`;

export function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>): React.ReactNode {
  return (
    <CommandPrimitive.Separator data-slot="command-separator" className={cx(separatorClass, className)} {...props} />
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
  &[data-disabled='true'] {
    pointer-events: none;
    opacity: 0.5;
  }
  &[data-selected='true'] {
    background-color: var(--muted);
    color: var(--foreground);
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

export function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>): React.ReactNode {
  return (
    <CommandPrimitive.Item data-slot="command-item" className={cx(itemClass, className)} {...props}>
      {children}
    </CommandPrimitive.Item>
  );
}

const shortcutClass = css`
  margin-left: auto;
  font-size: 0.75rem;
  letter-spacing: 0.1em;
  color: var(--muted-foreground);
`;

export function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>): React.ReactNode {
  return <span data-slot="command-shortcut" className={cx(shortcutClass, className)} {...props} />;
}
