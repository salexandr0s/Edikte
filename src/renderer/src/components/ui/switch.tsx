import { Switch as RadixSwitch } from 'radix-ui'
import { useId, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

interface SwitchProps {
  id?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  className?: string
}

/** An on/off toggle for settings that take effect at once. */
export function Switch({ className, ...props }: SwitchProps) {
  return (
    <RadixSwitch.Root
      {...props}
      className={cx(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-border-strong p-0.5 transition-colors duration-120',
        'data-[state=checked]:bg-accent-fill',
        'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft',
        'disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
    >
      <RadixSwitch.Thumb className="block size-4 rounded-full bg-white shadow-sm transition-transform duration-120 ease-standard data-[state=checked]:translate-x-4" />
    </RadixSwitch.Root>
  )
}

interface SwitchRowProps extends Omit<SwitchProps, 'id' | 'aria-label' | 'aria-describedby'> {
  label: ReactNode
  description?: ReactNode
}

/** Label and description on the left, the switch on the right; the row is the click target. */
export function SwitchRow({ label, description, className, ...props }: SwitchRowProps) {
  const id = useId()
  const descriptionId = description === undefined ? undefined : `${id}-description`
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <label
        htmlFor={id}
        className={cx(
          'flex min-w-0 flex-col gap-0.5',
          props.disabled === true && 'cursor-not-allowed opacity-55',
        )}
      >
        <span className="text-sm text-fg">{label}</span>
        {description !== undefined && (
          <span id={descriptionId} className="text-xs text-fg-muted">
            {description}
          </span>
        )}
      </label>
      <Switch id={id} aria-describedby={descriptionId} className="mt-0.5" {...props} />
    </div>
  )
}
