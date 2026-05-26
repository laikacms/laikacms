import { Slot } from 'radix-ui';
import * as React from 'react';

import { css, variants } from './_styled';

const base = css`
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  outline: none;
  transition: background-color 0.15s, color 0.15s, box-shadow 0.15s;
  &:disabled {
    pointer-events: none;
    opacity: 0.5;
  }
  &:focus-visible {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring), transparent 70%);
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

export const buttonVariants = variants(base, {
  variants: {
    variant: {
      default: css`
        background-color: var(--primary);
        color: var(--primary-foreground);
        &:hover {
          background-color: color-mix(in srgb, var(--primary), transparent 20%);
        }
      `,
      outline: css`
        border-color: var(--border);
        background-color: var(--background);
        &:hover {
          background-color: var(--muted);
          color: var(--foreground);
        }
        &[aria-expanded='true'] {
          background-color: var(--muted);
          color: var(--foreground);
        }
      `,
      secondary: css`
        background-color: var(--secondary);
        color: var(--secondary-foreground);
        &:hover {
          background-color: color-mix(in srgb, var(--secondary), transparent 20%);
        }
      `,
      ghost: css`
        background-color: transparent;
        &:hover {
          background-color: var(--muted);
          color: var(--foreground);
        }
        &[aria-expanded='true'] {
          background-color: var(--muted);
          color: var(--foreground);
        }
      `,
      destructive: css`
        background-color: color-mix(in srgb, var(--destructive), transparent 90%);
        color: var(--destructive);
        &:hover {
          background-color: color-mix(in srgb, var(--destructive), transparent 80%);
        }
      `,
      link: css`
        background-color: transparent;
        color: var(--primary);
        text-underline-offset: 4px;
        &:hover {
          text-decoration: underline;
        }
      `,
    },
    size: {
      default: css`
        height: 2.25rem;
        padding: 0 0.625rem;
      `,
      xs: css`
        height: 1.5rem;
        gap: 0.25rem;
        padding: 0 0.5rem;
        font-size: 0.75rem;
      `,
      sm: css`
        height: 2rem;
        gap: 0.25rem;
        padding: 0 0.625rem;
      `,
      lg: css`
        height: 2.5rem;
        padding: 0 0.625rem;
      `,
      icon: css`
        width: 2.25rem;
        height: 2.25rem;
      `,
      'icon-xs': css`
        width: 1.5rem;
        height: 1.5rem;
      `,
      'icon-sm': css`
        width: 2rem;
        height: 2rem;
      `,
      'icon-lg': css`
        width: 2.5rem;
        height: 2.5rem;
      `,
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
export type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';

export type ButtonProps = React.ComponentProps<'button'> & {
  variant?: ButtonVariant,
  size?: ButtonSize,
  asChild?: boolean,
};

export function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: ButtonProps): React.ReactNode {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}
