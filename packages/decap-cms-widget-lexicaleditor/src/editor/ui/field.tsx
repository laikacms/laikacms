import * as React from 'react';
import { useMemo } from 'react';

import { css, cx, variants } from './_styled';
import { Label } from './label';
import { Separator } from './separator';

const fieldSetClass = css`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`;

export function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>): React.ReactNode {
  return <fieldset data-slot="field-set" className={cx(fieldSetClass, className)} {...props} />;
}

const legendClass = css`
  margin-bottom: 0.75rem;
  font-weight: 500;
  &[data-variant='label'] {
    font-size: 0.875rem;
  }
  &[data-variant='legend'] {
    font-size: 1rem;
  }
`;

export function FieldLegend({
  className,
  variant = 'legend',
  ...props
}: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }): React.ReactNode {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cx(legendClass, className)}
      {...props}
    />
  );
}

const fieldGroupClass = css`
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 1.75rem;
`;

export function FieldGroup({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
  return <div data-slot="field-group" className={cx(fieldGroupClass, className)} {...props} />;
}

const fieldBase = css`
  display: flex;
  width: 100%;
  gap: 0.75rem;
  &[data-invalid='true'] {
    color: var(--destructive);
  }
`;

export const fieldVariants = variants(fieldBase, {
  variants: {
    orientation: {
      vertical: css`
        flex-direction: column;
        & > * {
          width: 100%;
        }
      `,
      horizontal: css`
        flex-direction: row;
        align-items: center;
      `,
      responsive: css`
        flex-direction: column;
        & > * {
          width: 100%;
        }
      `,
    },
  },
  defaultVariants: { orientation: 'vertical' },
});

export function Field({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<'div'> & {
  orientation?: 'vertical' | 'horizontal' | 'responsive',
}): React.ReactNode {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={fieldVariants({ orientation, className })}
      {...props}
    />
  );
}

const fieldContentClass = css`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.25rem;
  line-height: 1.375;
`;

export function FieldContent({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
  return <div data-slot="field-content" className={cx(fieldContentClass, className)} {...props} />;
}

const fieldLabelClass = css`
  display: flex;
  width: fit-content;
  gap: 0.5rem;
  line-height: 1.375;
`;

export function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>): React.ReactNode {
  return <Label data-slot="field-label" className={cx(fieldLabelClass, className)} {...props} />;
}

const fieldTitleClass = css`
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  line-height: 1.375;
  font-weight: 500;
`;

export function FieldTitle({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
  return <div data-slot="field-label" className={cx(fieldTitleClass, className)} {...props} />;
}

const fieldDescriptionClass = css`
  text-align: left;
  font-size: 0.875rem;
  line-height: 1.5;
  font-weight: 400;
  color: var(--muted-foreground);
  & > a {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  & > a:hover {
    color: var(--primary);
  }
`;

export function FieldDescription({ className, ...props }: React.ComponentProps<'p'>): React.ReactNode {
  return <p data-slot="field-description" className={cx(fieldDescriptionClass, className)} {...props} />;
}

const fieldSeparatorClass = css`
  position: relative;
  margin: -0.5rem 0;
  height: 1.25rem;
  font-size: 0.875rem;
`;

const fieldSeparatorLineClass = css`
  position: absolute;
  inset: 0;
  top: 50%;
`;

const fieldSeparatorContentClass = css`
  position: relative;
  margin: 0 auto;
  display: block;
  width: fit-content;
  background-color: var(--background);
  padding: 0 0.5rem;
  color: var(--muted-foreground);
`;

export function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & { children?: React.ReactNode }): React.ReactNode {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cx(fieldSeparatorClass, className)}
      {...props}
    >
      <Separator className={fieldSeparatorLineClass} />
      {children && (
        <span className={fieldSeparatorContentClass} data-slot="field-separator-content">
          {children}
        </span>
      )}
    </div>
  );
}

const fieldErrorClass = css`
  font-size: 0.875rem;
  font-weight: 400;
  color: var(--destructive);
`;

const fieldErrorListClass = css`
  margin-left: 1rem;
  display: flex;
  list-style: disc;
  flex-direction: column;
  gap: 0.25rem;
`;

export function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: Array<{ message?: string } | undefined>,
}): React.ReactNode {
  const content = useMemo(() => {
    if (children) return children;
    if (!errors?.length) return null;
    const unique = [...new Map(errors.map(error => [error?.message, error])).values()];
    if (unique.length === 1) return unique[0]?.message;
    return (
      <ul className={fieldErrorListClass}>
        {unique.map(
          (error, index) => error?.message && <li key={index}>{error.message}</li>,
        )}
      </ul>
    );
  }, [children, errors]);

  if (!content) return null;
  return (
    <div role="alert" data-slot="field-error" className={cx(fieldErrorClass, className)} {...props}>
      {content}
    </div>
  );
}
