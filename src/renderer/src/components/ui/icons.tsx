import type { SVGProps } from 'react'
import { cx } from '../../lib/cx'

// 16 px stroke icons on a 16-unit grid. They are decorative: the button or
// link around them carries the accessible name.

export type IconProps = SVGProps<SVGSVGElement>

export function Icon({ className, children, ...props }: IconProps) {
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

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </Icon>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5L10.5 8 6 12.5" />
    </Icon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </Icon>
  )
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 10L8 5.5l4.5 4.5" />
    </Icon>
  )
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
    </Icon>
  )
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M3.5 8.5L8 13l4.5-4.5" />
    </Icon>
  )
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v3.5h-9v-9H6" />
    </Icon>
  )
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Icon {...props}>
      <path
        d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </Icon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8.5l3 3 7-7" />
    </Icon>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.25 8.25l1.9 1.9 3.6-3.9" />
    </Icon>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.5l6 11H2zM8 6.5v3M8 11.5v.01" />
    </Icon>
  )
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 5v3.5M8 11v.01" />
    </Icon>
  )
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.5V11M8 5v.01" />
    </Icon>
  )
}

export function XCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6 6l4 4M10 6l-4 4" />
    </Icon>
  )
}

export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 1.5h5l3 3v10H4zM9 1.5v3h3" />
    </Icon>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5v3h-3" />
    </Icon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </Icon>
  )
}

export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 3h12l-4.5 5.5V13l-3-1.5v-3z" />
    </Icon>
  )
}

export function BookmarkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 2.5h8v11l-4-2.8-4 2.8z" />
    </Icon>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 7v4M9.5 7v4" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M3 8h10" />
    </Icon>
  )
}

export function SparklesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 2.5l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3L2 7l3.3-1.2zM12 9.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </Icon>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
    </Icon>
  )
}

export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 14.5s4.5-4.2 4.5-7.8a4.5 4.5 0 10-9 0c0 3.6 4.5 7.8 4.5 7.8z" />
      <circle cx="8" cy="6.7" r="1.6" />
    </Icon>
  )
}

export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.75 8h12.5M8 1.75c1.8 1.9 2.7 4 2.7 6.25S9.8 12.4 8 14.25c-1.8-1.85-2.7-4-2.7-6.25S6.2 3.65 8 1.75z" />
    </Icon>
  )
}

export function GavelIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 13.5h7M6.2 4.3l2.9-2.9 4.4 4.4-2.9 2.9zM7.6 7.3L2.8 12.1M8.8 2.6l-1 1M12.8 6.6l-1 1" />
    </Icon>
  )
}

/** Eight teeth on a 6.6 radius, generated so every tooth is the same. */
export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="2" />
      <path d="M6.96 3.11L7.25 1.44 8.75 1.44 9.04 3.11A5 5 0 0 1 10.72 3.81L12.11 2.83 13.17 3.89 12.19 5.28A5 5 0 0 1 12.89 6.96L14.56 7.25 14.56 8.75 12.89 9.04A5 5 0 0 1 12.19 10.72L13.17 12.11 12.11 13.17 10.72 12.19A5 5 0 0 1 9.04 12.89L8.75 14.56 7.25 14.56 6.96 12.89A5 5 0 0 1 5.28 12.19L3.89 13.17 2.83 12.11 3.81 10.72A5 5 0 0 1 3.11 9.04L1.44 8.75 1.44 7.25 3.11 6.96A5 5 0 0 1 3.81 5.28L2.83 3.89 3.89 2.83 5.28 3.81A5 5 0 0 1 6.96 3.11Z" />
    </Icon>
  )
}

export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
    </Icon>
  )
}

export function InboxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 9.5V12a1.5 1.5 0 001.5 1.5h8a1.5 1.5 0 001.5-1.5V9.5M2.5 9.5l1.8-6.3a1 1 0 011-.7h5.4a1 1 0 011 .7l1.8 6.3M2.5 9.5H6l.8 1.5h2.4l.8-1.5h3.5" />
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
