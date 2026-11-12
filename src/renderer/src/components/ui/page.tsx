import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

interface PageProps {
  /** `narrow` for forms and settings, `wide` for lists and grids. */
  width?: 'wide' | 'narrow'
  className?: string
  children: ReactNode
}

/** A screen's column, so every screen has the same gutters and rhythm. */
export function Page({ width = 'wide', className, children }: PageProps) {
  return (
    <div
      className={cx(
        'mx-auto flex w-full flex-col gap-6 px-6 py-6',
        width === 'wide' ? 'max-w-7xl' : 'max-w-3xl',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface PageHeaderProps {
  title: ReactNode
  /** For `aria-labelledby` on the screen's main region or table. */
  titleId?: string
  description?: ReactNode
  /** A back button above the title. */
  back?: ReactNode
  /** Buttons and status on the right; the group moves under the title when space runs out. */
  actions?: ReactNode
  /** Further lines under the description. */
  children?: ReactNode
}

/**
 * The screen title. The shell moves focus to this h1 after a screen change,
 * so it takes focus but shows no ring.
 */
export function PageHeader({
  title,
  titleId,
  description,
  back,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      {back !== undefined && <div className="-ml-3 self-start">{back}</div>}
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            id={titleId}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight outline-none"
          >
            {title}
          </h1>
          {description !== undefined && <p className="text-sm text-fg-muted">{description}</p>}
          {children}
        </div>
        {actions !== undefined && (
          <div className="flex max-w-full items-center gap-3">{actions}</div>
        )}
      </div>
    </header>
  )
}
