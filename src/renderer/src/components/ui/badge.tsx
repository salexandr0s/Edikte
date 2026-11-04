import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'outline'

interface BadgeProps {
  variant?: BadgeVariant
  size?: 'sm' | 'md'
  /** A dot before the label for live states such as "running". */
  dot?: boolean
  title?: string
  className?: string
  children: ReactNode
}

// badge.v1. Labels stay short: a badge never wraps or truncates.
const VARIANTS: Record<BadgeVariant, string> = {
  default: 'border border-border bg-bg-muted text-fg',
  primary: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  success: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  danger: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
  outline: 'border border-border-strong text-fg',
}

export function Badge({
  variant = 'default',
  size = 'md',
  dot,
  title,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full text-xs font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5' : 'h-6 px-2',
        VARIANTS[variant],
        className,
      )}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
