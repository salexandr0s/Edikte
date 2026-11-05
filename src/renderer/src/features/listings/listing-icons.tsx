import type { SVGProps } from 'react'
import { cx } from '../../lib/cx'

// Icons the shared set lacks, drawn like components/ui/icons.tsx: 16 px,
// stroke only, decorative. The control around them carries the name.

type IconProps = SVGProps<SVGSVGElement>

function Icon({ className, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx('size-4 shrink-0', className)}
      {...props}
    >
      {children}
    </svg>
  )
}

export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 3h12l-4.5 5.5V13l-3-1.5v-3z" />
    </Icon>
  )
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  )
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.4 3.7A6.5 6.5 0 018 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 01-1.8 2.3M4.2 4.9C2.5 6.1 1.5 8 1.5 8S4 12.5 8 12.5c1.2 0 2.3-.4 3.2-1M6.6 6.6a2 2 0 002.8 2.8M2 2l12 12" />
    </Icon>
  )
}

/** Both arrows: the column can be sorted but is not the sort column. */
export function SortableIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
    </Icon>
  )
}
