import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ListingSortColumnSchema, type ListingQuery, type ListingRow } from '@shared/domain'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { Select } from '../../components/ui/field'
import { AlertIcon, RefreshIcon } from '../../components/ui/icons'
import { Spinner } from '../../components/ui/spinner'
import { useFormat } from '../../lib/format'
import { nextSort, type AnalysisTracker, type ListingSort } from './query-helpers'
import { ResultsTable } from './results-table'
import type { ListingPageState } from './use-listing-page'
import type { SyncControls } from './use-sync'

const FRAME = 'rounded-lg border border-border'

interface ListingResultsProps {
  titleId: string
  query: ListingQuery
  state: ListingPageState
  /** The page's rows with unconfirmed star and hide changes. */
  rows: ListingRow[]
  tracker: AnalysisTracker
  sync: SyncControls
  onSort: (sort: ListingSort) => void
  onReset: () => void
  onOpen: (row: ListingRow) => void
  onStar: (row: ListingRow) => void
  onToggleHidden: (row: ListingRow) => void
}

/** Count, sort order and table, or the empty state that explains what to do. */
export function ListingResults({
  titleId,
  query,
  state,
  rows,
  tracker,
  sync,
  onSort,
  onReset,
  ...rowActions
}: ListingResultsProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const { page, error, loading, reload } = state

  if (page === null) {
    if (error === null) {
      return (
        <div className="flex justify-center py-16">
          <Spinner label={t('common.loading')} />
        </div>
      )
    }
    return (
      <EmptyState
        className={FRAME}
        title={t('listings.loadFailed')}
        description={t(`errors.${error}`)}
        action={
          <Button variant="outline" onClick={reload}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

  if (page.totalInScope === 0) {
    const syncing = sync.status !== null && sync.status.state !== 'idle'
    return (
      <EmptyState
        className={FRAME}
        title={t('listings.empty')}
        description={t('listings.emptyText')}
        action={
          <Button loading={syncing || sync.pending === 'start'} onClick={sync.start}>
            <RefreshIcon />
            {t('sync.now')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p aria-live="polite" className="text-sm text-fg-muted">
            {t('listings.count', {
              count: page.totalInScope,
              shown: format.number(rows.length),
              total: format.number(page.totalInScope),
            })}
          </p>
          {loading && <Spinner className="text-fg-muted" />}
        </div>
        <SortControl sort={query.sort} onSort={onSort} />
      </div>

      {error !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-bg-muted px-4 py-3 text-sm"
        >
          <AlertIcon className="text-danger-text" />
          <span className="min-w-0 flex-1">
            {t('listings.updateFailed')} {t(`errors.${error}`)}
          </span>
          <Button variant="outline" size="sm" onClick={reload}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          className={FRAME}
          title={t('listings.noMatches')}
          description={t('listings.noMatchesText')}
          action={
            <Button variant="outline" onClick={onReset}>
              {t('filters.reset')}
            </Button>
          }
        />
      ) : (
        <ResultsTable
          labelledBy={titleId}
          rows={rows}
          sort={query.sort}
          priceBasis={query.priceBasis}
          tracker={tracker}
          busy={loading}
          onSort={onSort}
          {...rowActions}
        />
      )}
    </div>
  )
}

/** Every sort column, including the two without a table header. */
function SortControl({ sort, onSort }: { sort: ListingSort; onSort: (sort: ListingSort) => void }) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-fg-muted">
        {t('listings.sort.label')}
      </label>
      <Select
        id={id}
        size="sm"
        className="w-auto"
        value={sort.column}
        onChange={(event) => {
          const column = ListingSortColumnSchema.safeParse(event.target.value)
          if (column.success) onSort(nextSort(sort, column.data))
        }}
      >
        {ListingSortColumnSchema.options.map((column) => (
          <option key={column} value={column}>
            {t(`listings.sort.column.${column}`)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('listings.sort.direction')}
        size="sm"
        className="w-auto"
        value={sort.direction}
        onChange={(event) =>
          onSort({ column: sort.column, direction: event.target.value === 'desc' ? 'desc' : 'asc' })
        }
      >
        <option value="asc">{t('listings.sort.asc')}</option>
        <option value="desc">{t('listings.sort.desc')}</option>
      </Select>
    </div>
  )
}
