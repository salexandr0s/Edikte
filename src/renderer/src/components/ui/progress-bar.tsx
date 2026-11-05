import { cx } from '../../lib/cx'

interface ProgressBarProps {
  value: number
  /** 0 when the total is not known yet: the bar then shows activity only. */
  max: number
  label: string
  className?: string
}

export function ProgressBar({ value, max, label, className }: ProgressBarProps) {
  const determinate = max > 0
  const percent = determinate ? Math.min(100, Math.max(0, (value / max) * 100)) : 100
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? max : undefined}
      aria-valuenow={determinate ? value : undefined}
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-border', className)}
    >
      <div
        className={cx(
          'h-full rounded-full bg-accent transition-[width] duration-220',
          !determinate && 'animate-pulse',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
