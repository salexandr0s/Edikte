import { ToggleGroup } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface Segment<T extends string> {
  value: T
  label: ReactNode
  /** The accessible name when the label is an icon. */
  'aria-label'?: string
  title?: string
}

interface SegmentedControlProps<T extends string> {
  'aria-label': string
  segments: readonly Segment<T>[]
  value: T
  onValueChange: (value: T) => void
  size?: 'sm' | 'md'
  /** Segments share the width instead of fitting their labels. */
  fill?: boolean
  className?: string
}

/**
 * One choice from a few, side by side. The chosen segment is raised; a click
 * on it keeps it chosen, so there is always a value.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onValueChange,
  size = 'md',
  fill = false,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next !== '') onValueChange(next as T)
      }}
      aria-label={aria['aria-label']}
      className={cx(
        'inline-flex shrink-0 items-stretch rounded-md bg-fill-muted p-0.5',
        size === 'sm' ? 'h-8' : 'h-10',
        fill ? 'grid w-full auto-cols-fr grid-flow-col' : 'inline-flex',
        className,
      )}
    >
      {segments.map((segment) => (
        <ToggleGroup.Item
          key={segment.value}
          value={segment.value}
          aria-label={segment['aria-label']}
          title={segment.title}
          className={cx(
            'inline-flex items-center justify-center gap-1.5 rounded-sm text-sm font-medium whitespace-nowrap text-fg-muted transition-[background-color,color,box-shadow] duration-120 select-none',
            size === 'sm' ? 'px-2.5' : 'px-3',
            'hover:text-fg data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-sm',
            'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft',
          )}
        >
          {segment.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
