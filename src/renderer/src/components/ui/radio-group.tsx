import { RadioGroup as RadixRadioGroup } from 'radix-ui'
import { useId, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

export interface RadioOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
}

interface RadioGroupProps<T extends string> {
  /** The group's accessible name; shown unless `hideLabel` is set. */
  label: ReactNode
  hideLabel?: boolean
  options: readonly RadioOption<T>[]
  value: T
  onValueChange: (value: T) => void
  disabled?: boolean
  /** `cards` draws each option as a selectable row with a border. */
  variant?: 'list' | 'cards'
  'aria-describedby'?: string
  className?: string
}

/**
 * Radio buttons drawn by the app. Arrow keys move the selection; the whole
 * label is the click target.
 */
export function RadioGroup<T extends string>({
  label,
  hideLabel = false,
  options,
  value,
  onValueChange,
  disabled,
  variant = 'list',
  className,
  ...props
}: RadioGroupProps<T>) {
  const labelId = useId()
  const cards = variant === 'cards'
  return (
    <div className={cx('flex min-w-0 flex-col', hideLabel ? '' : 'gap-2', className)}>
      <span id={labelId} className={cx('text-sm font-medium text-fg', hideLabel && 'sr-only')}>
        {label}
      </span>
      <RadixRadioGroup.Root
        aria-labelledby={labelId}
        aria-describedby={props['aria-describedby']}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onValueChange(next as T)}
        className={cx('flex flex-col', cards ? 'gap-2' : 'gap-2.5')}
      >
        {options.map((option) => {
          const itemId = `${labelId}-${option.value}`
          return (
            <label
              key={option.value}
              htmlFor={itemId}
              className={cx(
                'flex min-w-0 items-start gap-2.5 text-sm text-fg',
                cards &&
                  'rounded-md border border-border bg-surface px-4 py-3 shadow-xs transition-[border-color,background-color,box-shadow] duration-120 hover:border-border-strong has-data-[state=checked]:border-accent-fill has-data-[state=checked]:bg-accent-soft',
                disabled === true && 'cursor-not-allowed opacity-55',
              )}
            >
              <RadixRadioGroup.Item
                id={itemId}
                value={option.value}
                className={cx(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface shadow-xs transition-[background-color,border-color,box-shadow] duration-120',
                  'hover:border-fg-muted data-[state=checked]:border-accent-fill data-[state=checked]:bg-accent-fill',
                  'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft',
                  'disabled:cursor-not-allowed',
                )}
              >
                <RadixRadioGroup.Indicator className="size-1.5 animate-check-in rounded-full bg-white" />
              </RadixRadioGroup.Item>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cx(cards && 'font-medium')}>{option.label}</span>
                {option.description !== undefined && (
                  <span className="text-xs text-fg-muted">{option.description}</span>
                )}
              </span>
            </label>
          )
        })}
      </RadixRadioGroup.Root>
    </div>
  )
}
