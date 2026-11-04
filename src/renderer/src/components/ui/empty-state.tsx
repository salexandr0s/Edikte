import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

interface EmptyStateProps {
  title: ReactNode
  /** Why it is empty and what to do next (table.v1). */
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      <p className="text-base font-medium text-fg">{title}</p>
      {description !== undefined && <p className="max-w-md text-sm text-fg-muted">{description}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  )
}
