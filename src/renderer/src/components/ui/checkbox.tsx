import { Checkbox as RadixCheckbox } from 'radix-ui'
import { useId, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { CheckIcon } from './icons'

export interface CheckboxProps {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
}

/**
 * A checkbox drawn by the app, so it matches in both appearances: a 16 px box
 * that fills with the accent and draws its check mark. Space toggles it.
 */
export function Checkbox({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
}: CheckboxProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = description === undefined ? undefined : `${inputId}-description`
  return (
    <div className={cx('flex items-start gap-2.5', className)}>
      <RadixCheckbox.Root
        id={inputId}
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className={cx(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-xs border border-border-strong bg-surface text-white shadow-xs transition-[background-color,border-color,box-shadow] duration-120',
          'hover:border-fg-muted data-[state=checked]:border-accent-fill data-[state=checked]:bg-accent-fill data-[state=checked]:shadow-raised',
          'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft data-[state=checked]:focus-visible:ring-ring-soft',
          'disabled:cursor-not-allowed disabled:opacity-55',
        )}
      >
        <RadixCheckbox.Indicator className="animate-check-in">
          <CheckIcon className="size-3" strokeWidth={2.25} />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <div className="flex min-w-0 flex-col">
        <label
          htmlFor={inputId}
          className={cx('text-sm text-fg', disabled === true && 'cursor-not-allowed opacity-55')}
        >
          {label}
        </label>
        {description !== undefined && (
          <p id={descriptionId} className="text-xs text-fg-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
