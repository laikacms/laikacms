import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';

const boxClass = css`
  position: relative;
  display: flex;
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: 1px solid var(--input);
  outline: none;
  cursor: pointer;
  transition: box-shadow 0.15s;
  &:focus-visible {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring), transparent 50%);
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  &[data-state='checked'] {
    border-color: var(--primary);
    background-color: var(--primary);
    color: var(--primary-foreground);
  }
`;

const indicatorClass = css`
  display: grid;
  place-content: center;
  color: currentColor;
  & > svg {
    width: 0.875rem;
    height: 0.875rem;
  }
`;

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>): React.ReactNode {
  return (
    <CheckboxPrimitive.Root data-slot="checkbox" className={cx(boxClass, className)} {...props}>
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className={indicatorClass}>
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
