import { Toast as RadixToast } from 'radix-ui'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { Button } from './button'
import { CloseIcon } from './icons'

export type ToastKind = 'success' | 'info' | 'warning' | 'error'

export interface ToastOptions {
  kind: ToastKind
  title: string
  description?: string
  /** A follow-up such as "Open settings" when the user can fix the cause. */
  action?: { label: string; onClick: () => void }
}

interface ToastEntry extends ToastOptions {
  id: number
}

// toast.v1: a duration per kind and at most three toasts at a time.
const DURATIONS: Record<ToastKind, number> = {
  success: 3000,
  info: 3500,
  warning: 4500,
  error: 6000,
}
const MAX_VISIBLE = 3

const MARKERS: Record<ToastKind, string> = {
  success: 'bg-success',
  info: 'bg-accent',
  warning: 'bg-warning',
  error: 'bg-danger',
}

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const nextId = useRef(1)

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current
    nextId.current += 1
    setToasts((current) => [...current, { ...options, id }].slice(-MAX_VISIBLE))
  }, [])

  const remove = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }

  return (
    <ToastContext.Provider value={show}>
      <RadixToast.Provider swipeDirection="right" label={t('toast.region')}>
        {children}
        {toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            duration={DURATIONS[toast.kind]}
            type={toast.kind === 'error' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) remove(toast.id)
            }}
            className="flex items-start gap-3 rounded-md border border-border bg-surface-elevated p-4 text-fg shadow-md"
          >
            <span
              aria-hidden
              className={cx('mt-1.5 size-2 shrink-0 rounded-full', MARKERS[toast.kind])}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <RadixToast.Title className="text-sm font-medium">{toast.title}</RadixToast.Title>
              {toast.description !== undefined && (
                <RadixToast.Description className="text-sm text-fg-muted">
                  {toast.description}
                </RadixToast.Description>
              )}
              {toast.action !== undefined && (
                <RadixToast.Action altText={toast.action.label} asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 self-start"
                    onClick={toast.action.onClick}
                  >
                    {toast.action.label}
                  </Button>
                </RadixToast.Action>
              )}
            </div>
            <RadixToast.Close
              aria-label={t('common.close')}
              className="-m-1 rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
            >
              <CloseIcon />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed right-6 bottom-6 z-(--edk-z-toast) flex w-(--edk-toast-width) flex-col gap-3" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}

/** Shows a short message in the corner; use it for results, not for decisions. */
export function useToast(): (options: ToastOptions) => void {
  const show = useContext(ToastContext)
  if (show === null) throw new Error('useToast must be used inside ToastProvider')
  return show
}
