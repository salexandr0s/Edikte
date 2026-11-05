import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Buttons, primary action last (rightmost). */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /**
   * False keeps the dialog open on outside clicks, for decisions that need an
   * explicit answer. Escape still closes it.
   */
  dismissible?: boolean
}

// modal.v1 widths.
const WIDTHS = {
  sm: 'w-(--edk-modal-width-sm)',
  md: 'w-(--edk-modal-width-md)',
  lg: 'w-(--edk-modal-width-lg)',
} as const

/** Modal dialog with focus trap, Escape to close and focus return (Radix). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-(--edk-z-overlay) bg-overlay" />
        <RadixDialog.Content
          // Without a description, Radix wants aria-describedby unset explicitly.
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onPointerDownOutside={dismissible ? undefined : (event) => event.preventDefault()}
          className={cx(
            'fixed top-1/2 left-1/2 z-(--edk-z-modal) flex max-h-(--edk-modal-max-height) -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-surface-elevated p-6 text-fg shadow-lg',
            WIDTHS[size],
          )}
        >
          <div className="flex flex-col gap-2">
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
            <div className="flex flex-wrap justify-end gap-3 pt-2">{footer}</div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
