import { cx } from '../../lib/cx'

/** A loading placeholder the size of what will appear; decorative. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('skeleton rounded-md', className)} />
}
