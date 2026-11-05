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
  const percent = determinate ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? max : undefined}
      aria-valuenow={determinate ? value : undefined}
      className={cx('relative h-1.5 w-full overflow-hidden rounded-full bg-fill-muted', className)}
    >
      {determinate ? (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-220 ease-standard"
          style={{ width: `${percent}%` }}
        />
      ) : (
        <div className="absolute inset-y-0 left-0 w-1/3 animate-indeterminate rounded-full bg-accent" />
      )}
    </div>
  )
}
