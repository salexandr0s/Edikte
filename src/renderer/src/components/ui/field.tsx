import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { cx } from '../../lib/cx'

// input.v1. Controls fill their container; layouts set the width.
const CONTROL =
  'w-full min-w-0 border border-border bg-surface text-fg transition-colors placeholder:text-fg-muted hover:border-border-strong focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-55 aria-[invalid=true]:border-danger'

const INPUT_SIZES = { sm: 'h-8 rounded-sm px-3 text-sm', md: 'h-10 rounded-md px-4 text-sm' }
// Room on the right for the native arrow.
const SELECT_SIZES = {
  sm: 'h-8 rounded-sm pr-8 pl-3 text-sm',
  md: 'h-10 rounded-md pr-8 pl-4 text-sm',
}

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  size?: 'sm' | 'md'
}

export function Input({ size = 'md', className, ...props }: InputProps) {
  return <input className={cx(CONTROL, INPUT_SIZES[size], className)} {...props} />
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'size'> {
  size?: 'sm' | 'md'
}

/** Native select: keyboard and screen reader support come with it. */
export function Select({ size = 'md', className, children, ...props }: SelectProps) {
  return (
    <select className={cx(CONTROL, SELECT_SIZES[size], className)} {...props}>
      {children}
    </select>
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

interface ControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface FieldProps {
  label: ReactNode
  /** Renders the control. Spread the props onto it so label, help and error stay linked. */
  children: (control: ControlProps) => ReactNode
  help?: ReactNode
  /** Shown below the control, which gets aria-invalid (QG-FORM-001). */
  error?: ReactNode
  className?: string
}

export function Field({ label, help, error, className, children }: FieldProps) {
  const id = useId()
  const helpId = help === undefined ? undefined : `${id}-help`
  const errorId = error == null || error === false ? undefined : `${id}-error`
  const describedBy = [errorId, helpId].filter(Boolean).join(' ')
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': errorId === undefined ? undefined : true,
      })}
      {errorId !== undefined && (
        <p id={errorId} className="text-sm text-danger-text">
          {error}
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

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'size'> {
  label: ReactNode
  description?: ReactNode
}

export function Checkbox({ label, description, className, id, ...props }: CheckboxProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = description === undefined ? undefined : `${inputId}-description`
  return (
    <div className={cx('flex items-start gap-2', className)}>
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={descriptionId}
        className="mt-0.5 size-4 shrink-0 accent-accent-fill disabled:cursor-not-allowed disabled:opacity-55"
        {...props}
      />
      <div className="flex min-w-0 flex-col">
        <label htmlFor={inputId} className="text-sm text-fg">
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
