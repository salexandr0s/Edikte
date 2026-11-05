import { useId, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

interface CardProps {
  title?: ReactNode
  /** One line under the title on what the card holds. */
  description?: ReactNode
  /** Buttons or links shown next to the title. */
  actions?: ReactNode
  className?: string
  children: ReactNode
}

/** card.v1 default variant, as a labelled section. */
export function Card({ title, description, actions, className, children }: CardProps) {
  const titleId = useId()
  const hasHeader = title !== undefined || actions !== undefined
  return (
    <section
      aria-labelledby={title === undefined ? undefined : titleId}
      className={cx('rounded-lg border border-border bg-surface p-6 shadow-xs', className)}
    >
      {hasHeader && (
        <header className="mb-5 flex items-start justify-between gap-4">
          {title !== undefined && (
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                {title}
              </h2>
              {description !== undefined && <p className="text-sm text-fg-muted">{description}</p>}
            </div>
          )}
          {actions !== undefined && (
            <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      {children}
    </section>
  )
}
