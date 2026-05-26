import { Label as LabelPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';

const labelClass = css`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  line-height: 1;
  font-weight: 500;
  user-select: none;
`;

export function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>): React.ReactNode {
  return <LabelPrimitive.Root data-slot="label" className={cx(labelClass, className)} {...props} />;
}
