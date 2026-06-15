import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';
import { type ToggleSize, type ToggleVariant, toggleVariants } from './toggle';

const groupClass = css`
  display: flex;
  width: fit-content;
  flex-direction: row;
  align-items: center;
  gap: 0.125rem;
  border-radius: 0.375rem;
  &[data-orientation='vertical'] {
    flex-direction: column;
    align-items: stretch;
  }
`;

const ToggleGroupContext = React.createContext<{ variant?: ToggleVariant, size?: ToggleSize }>({
  variant: 'default',
  size: 'default',
});

export function ToggleGroup({
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & {
  variant?: ToggleVariant,
  size?: ToggleSize,
}): React.ReactNode {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cx(groupClass, className)}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

export function ToggleGroupItem({
  className,
  children,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & {
  variant?: ToggleVariant,
  size?: ToggleSize,
}): React.ReactNode {
  const context = React.useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={toggleVariants({
        variant: context.variant ?? variant,
        size: context.size ?? size,
        className,
      })}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}
