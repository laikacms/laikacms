import { Toggle as TogglePrimitive } from 'radix-ui';
import * as React from 'react';

import { css, variants } from './_styled';

export type ToggleVariant = 'default' | 'outline';
export type ToggleSize = 'default' | 'sm' | 'lg';

const base = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  background-color: transparent;
  transition: color 0.15s, box-shadow 0.15s, background-color 0.15s;
  &:hover {
    background-color: var(--muted);
    color: var(--foreground);
  }
  &:focus-visible {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring), transparent 70%);
  }
  &:disabled {
    pointer-events: none;
    opacity: 0.5;
  }
  &[aria-pressed='true'],
  &[data-state='on'] {
    background-color: var(--muted);
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

export const toggleVariants = variants(base, {
  variants: {
    variant: {
      default: css`
        background-color: transparent;
      `,
      outline: css`
        border-color: var(--input);
        &:hover {
          background-color: var(--muted);
        }
      `,
    },
    size: {
      default: css`
        height: 2.25rem;
        min-width: 2.25rem;
        padding: 0 0.625rem;
      `,
      sm: css`
        height: 2rem;
        min-width: 2rem;
        padding: 0 0.625rem;
      `,
      lg: css`
        height: 2.5rem;
        min-width: 2.5rem;
        padding: 0 0.625rem;
      `,
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export function Toggle({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & {
  variant?: ToggleVariant,
  size?: ToggleSize,
}): React.ReactNode {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={toggleVariants({ variant, size, className })}
      {...props}
    />
  );
}
