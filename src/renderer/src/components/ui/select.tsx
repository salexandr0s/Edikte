import { Select as RadixSelect } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from './icons'

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** A second, muted line under the label. */
  description?: string
  disabled?: boolean
}

export interface SelectProps<T extends string> {
  id?: string
  value: T
  onValueChange: (value: T) => void
  options: readonly SelectOption<T>[]
  size?: 'sm' | 'md'
  disabled?: boolean
  /** An icon on the left of the trigger. */
  leading?: ReactNode
  /** Where the menu lines up when it is wider than the trigger. */
  align?: 'start' | 'end'
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  /** The trigger fills its container; `w-auto` fits the chosen label instead. */
  className?: string
}

const TRIGGER_SIZES = {
  sm: 'h-8 rounded-sm pl-3 text-sm',
  md: 'h-10 rounded-md pl-4 text-sm',
} as const

/**
 * A dropdown select drawn by the app. The trigger looks like an input; the
 * menu opens below it with a check mark on the chosen option. Typing a
 * letter jumps to a matching option, arrow keys move, Enter chooses.
 */
export function Select<T extends string>({
  id,
  value,
  onValueChange,
  options,
  size = 'md',
  disabled,
  leading,
  align = 'start',
  className,
  ...aria
}: SelectProps<T>) {
  return (
    <RadixSelect.Root value={value} onValueChange={(next) => onValueChange(next as T)}>
      <RadixSelect.Trigger
        id={id}
        disabled={disabled}
        {...aria}
        className={cx(
          'group relative inline-flex w-full min-w-0 items-center gap-2 border border-border bg-surface pr-9 text-left text-fg shadow-xs transition-[border-color,box-shadow,background-color] duration-120 select-none',
          'hover:border-border-strong data-[state=open]:border-ring data-[state=open]:ring-3 data-[state=open]:ring-ring-soft',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring-soft focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-55 aria-[invalid=true]:border-danger',
          TRIGGER_SIZES[size],
          className,
        )}
      >
        {leading !== undefined && (
          <span aria-hidden="true" className="shrink-0 text-fg-muted">
            {leading}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          <RadixSelect.Value />
        </span>
        {/* The chevron sits a full step inside the edge, in line with the text inset. */}
        <RadixSelect.Icon className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-fg-muted transition-transform duration-160 ease-standard group-data-[state=open]:rotate-180">
          <ChevronDownIcon className="size-3.5" strokeWidth={1.75} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          side="bottom"
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cx(
            'z-(--edk-z-dropdown) max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) origin-(--radix-select-content-transform-origin) overflow-hidden rounded-md bg-surface-elevated text-fg shadow-popover',
            'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          )}
        >
          <RadixSelect.ScrollUpButton className="flex h-6 items-center justify-center text-fg-muted">
            <ChevronUpIcon className="size-3.5" />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cx(
                  'relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-3 pl-8 text-sm outline-none select-none',
                  'data-highlighted:bg-fill-muted data-[state=checked]:font-medium data-disabled:opacity-55',
                )}
              >
                <RadixSelect.ItemIndicator className="absolute left-2.5 text-accent-text">
                  <CheckIcon className="size-3.5" strokeWidth={2} />
                </RadixSelect.ItemIndicator>
                <span className="flex min-w-0 flex-col">
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  {option.description !== undefined && (
                    <span className="text-xs font-normal text-fg-muted">{option.description}</span>
                  )}
                </span>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex h-6 items-center justify-center text-fg-muted">
            <ChevronDownIcon className="size-3.5" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
