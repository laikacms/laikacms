import { Separator as SeparatorPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';

const separatorClass = css`
  flex-shrink: 0;
  background-color: var(--border);
  &[data-orientation='horizontal'] {
    height: 1px;
    width: 100%;
  }
  &[data-orientation='vertical'] {
    width: 1px;
    align-self: stretch;
  }
`;

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>): React.ReactNode {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cx(separatorClass, className)}
      {...props}
    />
  );
}
