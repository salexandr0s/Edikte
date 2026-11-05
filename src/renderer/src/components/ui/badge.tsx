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
  primary: 'bg-accent-subtle text-accent-subtle-fg',
  success: 'bg-success-subtle text-success-subtle-fg',
  warning: 'bg-warning-subtle text-warning-subtle-fg',
  danger: 'bg-danger-subtle text-danger-subtle-fg',
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
