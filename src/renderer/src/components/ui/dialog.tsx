import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { CloseIcon } from './icons'

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
  const { t } = useTranslation()
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-(--edk-z-overlay) bg-overlay backdrop-blur-xs data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RadixDialog.Content
          // Without a description, Radix wants aria-describedby unset explicitly.
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onPointerDownOutside={dismissible ? undefined : (event) => event.preventDefault()}
          className={cx(
            'fixed top-1/2 left-1/2 z-(--edk-z-modal) flex max-h-(--edk-modal-max-height) -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface-elevated text-fg shadow-xl outline-none',
            'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
            WIDTHS[size],
          )}
        >
          <div className="flex items-start gap-4 px-6 pt-6 pb-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <RadixDialog.Title className="text-lg font-semibold tracking-tight">
                {title}
              </RadixDialog.Title>
              {description !== undefined && (
                <RadixDialog.Description className="text-sm text-fg-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label={t('common.close')}
              className="-mt-1 -mr-2 flex size-8 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors duration-120 hover:bg-fill-muted hover:text-fg"
            >
              <CloseIcon />
            </RadixDialog.Close>
          </div>
          {children !== undefined && (
            <div className="min-h-0 overflow-y-auto px-6 pb-6 text-sm">{children}</div>
          )}
          {footer !== undefined && (
            <div
              className={cx(
                'flex flex-wrap justify-end gap-2 border-t border-border bg-bg-muted px-6 py-4',
                children === undefined && 'mt-2',
              )}
            >
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
