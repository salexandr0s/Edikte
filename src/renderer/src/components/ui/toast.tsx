import { Toast as RadixToast } from 'radix-ui'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { Button } from './button'
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon, XCircleIcon } from './icons'

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

const ICONS: Record<ToastKind, { icon: typeof InfoIcon; className: string }> = {
  success: { icon: CheckCircleIcon, className: 'text-success-text' },
  info: { icon: InfoIcon, className: 'text-accent-text' },
  warning: { icon: AlertIcon, className: 'text-warning-text' },
  error: { icon: XCircleIcon, className: 'text-danger-text' },
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
        {toasts.map((toast) => {
          const { icon: KindIcon, className: iconClass } = ICONS[toast.kind]
          return (
            <RadixToast.Root
              key={toast.id}
              duration={DURATIONS[toast.kind]}
              type={toast.kind === 'error' ? 'foreground' : 'background'}
              onOpenChange={(open) => {
                if (!open) remove(toast.id)
              }}
              className={cx(
                'flex items-start gap-3 rounded-md border border-border bg-surface-elevated p-4 text-fg shadow-lg',
                'data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out data-[swipe=end]:animate-toast-out',
                'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform',
              )}
            >
              <KindIcon className={cx('mt-0.5 size-5', iconClass)} />
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
                      className="mt-1.5 self-start"
                      onClick={toast.action.onClick}
                    >
                      {toast.action.label}
                    </Button>
                  </RadixToast.Action>
                )}
              </div>
              <RadixToast.Close
                aria-label={t('common.close')}
                className="-m-1.5 flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors duration-120 hover:bg-fill-muted hover:text-fg"
              >
                <CloseIcon className="size-3.5" />
              </RadixToast.Close>
            </RadixToast.Root>
          )
        })}
        <RadixToast.Viewport className="fixed right-6 bottom-6 z-(--edk-z-toast) flex w-(--edk-toast-width) flex-col gap-3 outline-none" />
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
