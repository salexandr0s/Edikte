import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { Button } from './button'
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
        <RadixDialog.Overlay className="fixed inset-0 z-(--edk-z-overlay) animate-fade-in bg-overlay backdrop-blur-(--edk-overlay-blur)" />
        <RadixDialog.Content
          // Without a description, Radix wants aria-describedby unset explicitly.
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onPointerDownOutside={dismissible ? undefined : (event) => event.preventDefault()}
          className={cx(
            'fixed top-1/2 left-1/2 z-(--edk-z-modal) flex max-h-(--edk-modal-max-height) -translate-x-1/2 -translate-y-1/2 animate-dialog-in flex-col gap-4 rounded-lg border border-border bg-surface-elevated p-6 text-fg shadow-lg',
            WIDTHS[size],
          )}
        >
          <div className="flex flex-col gap-2 pr-10">
            <RadixDialog.Title className="text-xl font-semibold tracking-tight">
              {title}
            </RadixDialog.Title>
            {description !== undefined && (
              <RadixDialog.Description className="text-sm text-fg-muted">
                {description}
              </RadixDialog.Description>
            )}
          </div>
          {children !== undefined && (
            <div className="-mx-1 min-h-0 overflow-y-auto px-1 text-sm">{children}</div>
          )}
          {footer !== undefined && (
            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">{footer}</div>
          )}
          {/* The wrapper positions the button: Button sets `relative` itself. */}
          <div className="absolute top-4 right-4">
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.close')}>
                <CloseIcon />
              </Button>
            </RadixDialog.Close>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
