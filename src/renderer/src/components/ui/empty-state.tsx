import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

interface EmptyStateProps {
  /** An icon in a soft disc above the title. */
  icon?: ReactNode
  title: ReactNode
  /** Why it is empty and what to do next (table.v1). */
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-6 py-16 text-center', className)}>
      {icon !== undefined && (
        <div
          aria-hidden="true"
          className="mb-2 flex size-12 items-center justify-center rounded-full bg-fill-muted text-fg-muted [&_svg]:size-5"
        >
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-fg">{title}</p>
      {description !== undefined && <p className="max-w-md text-sm text-fg-muted">{description}</p>}
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  )
}
