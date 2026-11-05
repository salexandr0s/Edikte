import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListingRow } from '@shared/domain'
import type { PriceBasis } from '@shared/enums'
import { ChevronDownIcon, ChevronUpIcon, SortableIcon } from '../../components/ui/icons'
import { cx } from '../../lib/cx'
import { ListingTableRow } from './listing-row'
import {
  currentAnalysisStatus,
  nextSort,
  type AnalysisTracker,
  type ListingSort,
  type SortColumn,
} from './query-helpers'

// table.v1. The header sticks to the top of the shell's scroll container.
// `isolate` on the frame keeps its z-index inside the table, so menus,
// dialogs and toasts still cover it.
const HEADER =
  'sticky top-0 z-(--edk-z-sticky) h-10 border-b border-border bg-bg-muted text-xs font-medium whitespace-nowrap text-fg-muted'

interface ResultsTableProps {
  labelledBy: string
  rows: ListingRow[]
  sort: ListingSort
  priceBasis: PriceBasis
  tracker: AnalysisTracker
  busy: boolean
  onSort: (sort: ListingSort) => void
  onOpen: (row: ListingRow) => void
  onStar: (row: ListingRow) => void
  onToggleHidden: (row: ListingRow) => void
}

export function ResultsTable({
  labelledBy,
  rows,
  sort,
  priceBasis,
  tracker,
  busy,
  onSort,
  onOpen,
  onStar,
  onToggleHidden,
}: ResultsTableProps) {
  const { t } = useTranslation()
  const sortable = (column: SortColumn, label: string, align: 'left' | 'right' = 'left') => (
    <SortHeader column={column} sort={sort} align={align} onSort={onSort}>
      {label}
    </SortHeader>
  )

  return (
    <div className="isolate rounded-lg border border-border bg-surface shadow-xs">
      <table
        aria-labelledby={labelledBy}
        aria-busy={busy || undefined}
        className={cx(
          'w-full border-separate border-spacing-0 text-sm transition-opacity duration-160',
          busy && 'opacity-70',
        )}
      >
        <thead>
          <tr>
            <th scope="col" className={cx(HEADER, 'w-10 rounded-tl-lg px-1')}>
              <span className="sr-only">{t('listings.columns.star')}</span>
            </th>
            <th scope="col" className={cx(HEADER, 'px-4 text-left')}>
              {t('listings.columns.object')}
            </th>
            {sortable('auctionAt', t('listings.columns.auctionAt'))}
            {sortable('price', t(`listings.columns.price.${priceBasis}`), 'right')}
            {sortable('area', t('listings.columns.area'), 'right')}
            {sortable('pricePerSqm', t('listings.columns.pricePerSqm'), 'right')}
            <th scope="col" className={cx(HEADER, 'px-4 text-left')}>
              {t('listings.columns.analysis')}
            </th>
            <th scope="col" className={cx(HEADER, 'w-10 rounded-tr-lg px-1')}>
              <span className="sr-only">{t('listings.columns.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ListingTableRow
              key={row.id}
              row={row}
              analysisStatus={currentAnalysisStatus(row, tracker)}
              onOpen={() => onOpen(row)}
              onStar={() => onStar(row)}
              onToggleHidden={() => onToggleHidden(row)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface SortHeaderProps {
  column: SortColumn
  sort: ListingSort
  align: 'left' | 'right'
  onSort: (sort: ListingSort) => void
  children: ReactNode
}

/** Clicking the active column flips the direction. */
function SortHeader({ column, sort, align, onSort, children }: SortHeaderProps) {
  const active = sort.column === column
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cx(HEADER, 'px-2', align === 'right' ? 'text-right' : 'text-left')}
    >
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, column))}
        className={cx(
          'group inline-flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors duration-120 hover:bg-fill-muted hover:text-fg',
          active && 'text-fg',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {children}
        {!active && (
          <SortableIcon className="size-3.5 opacity-40 transition-opacity group-hover:opacity-80" />
        )}
        {active && sort.direction === 'asc' && (
          <ChevronUpIcon className="size-3.5 text-accent-text" strokeWidth={2} />
        )}
        {active && sort.direction === 'desc' && (
          <ChevronDownIcon className="size-3.5 text-accent-text" strokeWidth={2} />
        )}
      </button>
    </th>
  )
}
