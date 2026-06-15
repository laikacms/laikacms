import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';

import { css, cx } from './_styled';
import { Button } from './button';

export function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>): React.ReactNode {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
): React.ReactNode {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogPortal(
  props: React.ComponentProps<typeof DialogPrimitive.Portal>,
): React.ReactNode {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

export function DialogClose(
  props: React.ComponentProps<typeof DialogPrimitive.Close>,
): React.ReactNode {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

const overlayClass = css`
  position: fixed;
  inset: 0;
  z-index: 50;
  background-color: rgb(0 0 0 / 0.1);
`;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>): React.ReactNode {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cx(overlayClass, className)} {...props} />;
}

const contentClass = css`
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 50;
  display: grid;
  width: 100%;
  max-width: calc(100% - 2rem);
  transform: translate(-50%, -50%);
  gap: 1.5rem;
  border-radius: 0.75rem;
  background-color: var(--popover);
  padding: 1.5rem;
  font-size: 0.875rem;
  color: var(--popover-foreground);
  outline: 1px solid color-mix(in srgb, var(--foreground), transparent 90%);
  @media (min-width: 640px) {
    max-width: 28rem;
  }
`;

const closeButtonClass = css`
  position: absolute;
  top: 1rem;
  right: 1rem;
`;

const srOnly = css`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`;

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean,
}): React.ReactNode {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cx(contentClass, className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button variant="ghost" size="icon-sm" className={closeButtonClass}>
              <XIcon />
              <span className={srOnly}>Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

const headerClass = css`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>): React.ReactNode {
  return <div data-slot="dialog-header" className={cx(headerClass, className)} {...props} />;
}

const footerClass = css`
  display: flex;
  flex-direction: column-reverse;
  gap: 0.5rem;
  @media (min-width: 640px) {
    flex-direction: row;
    justify-content: flex-end;
  }
`;

export function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & { showCloseButton?: boolean }): React.ReactNode {
  return (
    <div data-slot="dialog-footer" className={cx(footerClass, className)} {...props}>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

const titleClass = css`
  line-height: 1;
  font-weight: 500;
`;

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>): React.ReactNode {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cx(titleClass, className)} {...props} />;
}

const descriptionClass = css`
  font-size: 0.875rem;
  color: var(--muted-foreground);
`;

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>): React.ReactNode {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cx(descriptionClass, className)}
      {...props}
    />
  );
}
