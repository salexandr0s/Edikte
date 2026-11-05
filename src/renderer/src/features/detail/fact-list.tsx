import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

const COLUMNS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
} as const

interface FactListProps {
  columns?: keyof typeof COLUMNS
  className?: string
  children: ReactNode
}

/** A description list of label and value pairs, laid out in a grid. */
export function FactList({ columns = 2, className, children }: FactListProps) {
  return <dl className={cx('grid gap-x-6 gap-y-5', COLUMNS[columns], className)}>{children}</dl>
}

interface FactProps {
  label: ReactNode
  /** Set to "de" for text copied from the site or a Gutachten. */
  lang?: string
  className?: string
  children: ReactNode
}

export function Fact({ label, lang, className, children }: FactProps) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <dt className="text-xs font-medium text-fg-muted">{label}</dt>
      <dd lang={lang} className="text-sm wrap-break-word text-fg">
        {children}
      </dd>
    </div>
  )
}

/** A quote copied from the German PDF, shown in German in both UI languages. */
export function GermanQuote({ text, className }: { text: string; className?: string }) {
  return (
    <blockquote
      lang="de"
      className={cx(
        'border-l-2 border-border-strong pl-3 text-xs leading-relaxed wrap-break-word text-fg-muted',
        className,
      )}
    >
      „{text}“
    </blockquote>
  )
}
