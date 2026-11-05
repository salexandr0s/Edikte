import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { AlertCircleIcon } from './icons'

/*
 * input.v1. Controls fill their container; layouts set the width. Focus shows
 * as the accent border with a soft ring, on mouse focus too, so a field that
 * is being typed in is always obvious.
 */
const CONTROL =
  'w-full min-w-0 border border-border bg-surface text-fg shadow-xs transition-[border-color,box-shadow,background-color] duration-120 placeholder:text-fg-muted/70 hover:border-border-strong focus:border-ring focus:outline-none focus:ring-3 focus:ring-ring-soft disabled:cursor-not-allowed disabled:opacity-55 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20'

const INPUT_SIZES = {
  sm: 'h-8 rounded-sm px-3 text-sm',
  md: 'h-10 rounded-md px-4 text-sm',
} as const

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  size?: 'sm' | 'md'
  /** An icon on the left, inside the field. */
  leading?: ReactNode
  /** A small control on the right, inside the field, such as a clear button. */
  trailing?: ReactNode
}

export function Input({ size = 'md', leading, trailing, className, ...props }: InputProps) {
  if (leading === undefined && trailing === undefined) {
    return <input className={cx(CONTROL, INPUT_SIZES[size], className)} {...props} />
  }
  return (
    <div className={cx('relative', className)}>
      {leading !== undefined && (
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-muted',
            size === 'sm' ? 'left-2.5' : 'left-3',
          )}
        >
          {leading}
        </span>
      )}
      <input
        className={cx(
          CONTROL,
          INPUT_SIZES[size],
          leading !== undefined && (size === 'sm' ? 'pl-8' : 'pl-10'),
          trailing !== undefined && (size === 'sm' ? 'pr-8' : 'pr-10'),
        )}
        {...props}
      />
      {trailing !== undefined && (
        <span
          className={cx(
            'absolute top-1/2 flex -translate-y-1/2 items-center',
            size === 'sm' ? 'right-1' : 'right-1.5',
          )}
        >
          {trailing}
        </span>
      )}
    </div>
  )
}

export type TextareaProps = ComponentPropsWithRef<'textarea'>

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cx(CONTROL, 'min-h-24 rounded-md px-4 py-3 text-sm leading-normal', className)}
      {...props}
    />
  )
}

export interface ControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface FieldProps {
  label: ReactNode
  /** Keeps the label for screen readers only, e.g. when a placeholder shows it. */
  hideLabel?: boolean
  /** Renders the control. Spread the props onto it so label, help and error stay linked. */
  children: (control: ControlProps) => ReactNode
  help?: ReactNode
  /** Shown below the control, which gets aria-invalid (QG-FORM-001). */
  error?: ReactNode
  className?: string
}

export function Field({ label, hideLabel = false, help, error, className, children }: FieldProps) {
  const id = useId()
  const helpId = help === undefined ? undefined : `${id}-help`
  const errorId = error == null || error === false ? undefined : `${id}-error`
  const describedBy = [errorId, helpId].filter(Boolean).join(' ')
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cx('text-sm font-medium text-fg', hideLabel && 'sr-only')}>
        {label}
      </label>
      {children({
        id,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': errorId === undefined ? undefined : true,
      })}
      {errorId !== undefined && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger-text">
          <AlertCircleIcon className="mt-0.5" />
          <span>{error}</span>
        </p>
      )}
      {help !== undefined && (
        <p id={helpId} className="text-xs text-fg-muted">
          {help}
        </p>
      )}
    </div>
  )
}

/** The legend of a group of controls, in the same style as a field label. */
export function Legend({ className, children }: { className?: string; children: ReactNode }) {
  return <legend className={cx('text-sm font-medium text-fg', className)}>{children}</legend>
}
