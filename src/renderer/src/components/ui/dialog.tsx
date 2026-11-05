import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { CloseIcon } from './icons'

interface DialogProps {
  /** The control that opens the dialog, rendered in place. Focus returns to it on close. */
  trigger?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Buttons, primary action last (rightmost). An element with `mr-auto` sits on the left. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /**
   * False keeps the dialog open on outside clicks, for decisions that need an
   * explicit answer. Escape still closes it.
   */
  dismissible?: boolean
}

// modal.v1 widths, plus the app's xl step for the filter dialog.
const WIDTHS = {
  sm: 'w-(--edk-modal-width-sm)',
  md: 'w-(--edk-modal-width-md)',
  lg: 'w-(--edk-modal-width-lg)',
  xl: 'w-(--edk-modal-width-xl)',
} as const

/**
 * Modal dialog with focus trap and Escape to close (Radix). On close, focus
 * returns to `trigger`; a dialog opened some other way returns it nowhere, so
 * pass the opening control where there is one. The overlay dims and blurs the
 * page behind it. The close button comes last in the tab order, so the first
 * control of the body gets the initial focus.
 */
export function Dialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: DialogProps) {
  const { t } = useTranslation()
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-(--edk-z-overlay) bg-overlay backdrop-blur-(--edk-overlay-blur) data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        {/*
          A flex box the size of the window centres the dialog, so neither
          the dialog's transform nor its animation has a say in where it sits.
          The box lets clicks through to the overlay, which closes the dialog.
        */}
        <div className="pointer-events-none fixed inset-0 z-(--edk-z-modal) flex items-center justify-center">
          <RadixDialog.Content
            // Without a description, Radix wants aria-describedby unset explicitly.
            {...(description === undefined ? { 'aria-describedby': undefined } : {})}
            onPointerDownOutside={dismissible ? undefined : (event) => event.preventDefault()}
            className={cx(
              'pointer-events-auto relative flex max-h-(--edk-modal-max-height) flex-col overflow-hidden rounded-lg border border-border bg-surface-elevated text-fg shadow-xl outline-none',
              'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
              WIDTHS[size],
            )}
          >
            <div className="flex min-w-0 flex-col gap-1.5 px-6 pt-6 pr-14 pb-4">
              <RadixDialog.Title className="text-lg font-semibold tracking-tight">
                {title}
              </RadixDialog.Title>
              {description !== undefined && (
                <RadixDialog.Description className="text-sm text-fg-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            {children !== undefined && (
              <div className="min-h-0 overflow-y-auto px-6 pb-6 text-sm">{children}</div>
            )}
            {footer !== undefined && (
              <div
                className={cx(
                  'flex flex-wrap items-center justify-end gap-2 border-t border-border bg-bg-muted px-6 py-4',
                  children === undefined && 'mt-2',
                )}
              >
                {footer}
              </div>
            )}
            {/* Last in the DOM, so Tab reaches it after the body and the footer. */}
            <RadixDialog.Close
              aria-label={t('common.close')}
              className="absolute top-5 right-4 flex size-8 items-center justify-center rounded-sm text-fg-muted transition-colors duration-120 hover:bg-fill-muted hover:text-fg focus-visible:ring-3 focus-visible:ring-ring-soft focus-visible:outline-none"
            >
              <CloseIcon />
            </RadixDialog.Close>
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
