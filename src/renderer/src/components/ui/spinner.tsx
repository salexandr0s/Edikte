import { cx } from '../../lib/cx'

interface SpinnerProps {
  className?: string
  /** Announced to screen readers; without it the spinner is decorative. */
  label?: string
}

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <span
      role={label === undefined ? undefined : 'status'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={cx(
        'inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  )
}
