import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../lib/cx'
import { Spinner } from './spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and blocks clicks; the button keeps its width. */
  loading?: boolean
}

// button.v1. White text sits on the accent and danger fills (blue-700 and
// red-700), because the 500 shades fail WCAG AA behind white text.
//
// primary and destructive are raised fills; outline is the white "default"
// button with a hairline; secondary is the quiet grey fill; ghost has no
// box until hovered.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-fill text-white shadow-raised hover:bg-accent-fill-hover',
  secondary: 'bg-fill-muted text-fg hover:bg-fill-muted-hover',
  outline:
    'border border-border bg-surface text-fg shadow-xs hover:border-border-strong hover:bg-surface-hover',
  ghost: 'text-fg hover:bg-fill-muted',
  destructive: 'bg-danger-fill text-white shadow-raised hover:bg-danger-fill-hover',
  link: 'text-sm text-accent-text underline-offset-4 hover:underline',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-sm px-3 text-sm',
  md: 'h-10 gap-2 rounded-md px-4 text-sm',
  lg: 'h-12 gap-2 rounded-md px-5 text-base',
  icon: 'size-10 rounded-md',
  'icon-sm': 'size-8 rounded-sm',
}

/** Icon-only buttons (size `icon` or `icon-sm`) need an `aria-label`. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-120 select-none active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0',
        VARIANTS[variant],
        variant !== 'link' && SIZES[size],
        className,
      )}
      {...props}
    >
      <span className={cx('inline-flex items-center gap-[inherit]', loading && 'invisible')}>
        {children}
      </span>
      {loading && <Spinner className="absolute" />}
    </button>
  )
}
