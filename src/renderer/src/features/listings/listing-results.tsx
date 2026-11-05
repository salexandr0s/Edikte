import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ListingSortColumnSchema, type ListingQuery, type ListingRow } from '@shared/domain'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  InboxIcon,
  ListIcon,
  MapPinIcon,
  RefreshIcon,
  SearchIcon,
} from '../../components/ui/icons'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Select } from '../../components/ui/select'
import { Spinner } from '../../components/ui/spinner'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { ListingMap } from './listing-map'
import { nextSort, type AnalysisTracker, type ListingSort } from './query-helpers'
import { ResultsTable } from './results-table'
import { useGeocode } from './use-geocode'
import type { ListingPageState } from './use-listing-page'
import type { SyncControls } from './use-sync'

const FRAME = 'rounded-lg border border-border bg-surface shadow-xs'

export type ListingView = 'list' | 'map'

interface ListingResultsProps {
  titleId: string
  query: ListingQuery
  state: ListingPageState
  /** The page's rows with unconfirmed star and hide changes. */
  rows: ListingRow[]
  tracker: AnalysisTracker
  sync: SyncControls
  view: ListingView
  onViewChange: (view: ListingView) => void
  onSort: (sort: ListingSort) => void
  onReset: () => void
  onOpen: (row: ListingRow) => void
  onStar: (row: ListingRow) => void
  onToggleHidden: (row: ListingRow) => void
}

/** Count, view toggle, sort order and the table or map, or the empty state that explains what to do. */
export function ListingResults({
  titleId,
  query,
  state,
  rows,
  tracker,
  sync,
  view,
  onViewChange,
  onSort,
  onReset,
  ...rowActions
}: ListingResultsProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const { page, error, loading, reload } = state
  // Main looks addresses up only while the map is open.
  const geocode = useGeocode(view === 'map')

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
        icon={<AlertCircleIcon />}
        title={t('listings.loadFailed')}
        description={t(`errors.${error}`)}
        action={
          <Button variant="outline" onClick={reload}>
            <RefreshIcon />
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
        icon={<InboxIcon />}
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
    <div className={cx('flex flex-col gap-3', view === 'map' && 'min-h-0 flex-1')}>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p aria-live="polite" className="text-sm text-fg-muted tabular-nums">
            {t('listings.count', {
              count: page.totalInScope,
              shown: format.number(rows.length),
              total: format.number(page.totalInScope),
            })}
          </p>
          {loading && <Spinner className="size-3.5 text-fg-muted" />}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {view === 'list' && <SortControl sort={query.sort} onSort={onSort} />}
          <ViewToggle view={view} onViewChange={onViewChange} />
        </div>
      </div>

      {error !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-danger-subtle bg-danger-subtle/40 px-4 py-3 text-sm"
        >
          <AlertCircleIcon className="text-danger-text" />
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
          icon={<SearchIcon />}
          title={t('listings.noMatches')}
          description={t('listings.noMatchesText')}
          action={
            <Button variant="outline" onClick={onReset}>
              {t('filters.reset')}
            </Button>
          }
        />
      ) : view === 'map' ? (
        <ListingMap rows={rows} geocode={geocode} onOpen={rowActions.onOpen} />
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

/** List or map, side by side as icons. */
function ViewToggle({
  view,
  onViewChange,
}: {
  view: ListingView
  onViewChange: (view: ListingView) => void
}) {
  const { t } = useTranslation()
  return (
    <SegmentedControl
      aria-label={t('map.view.label')}
      size="sm"
      value={view}
      onValueChange={onViewChange}
      segments={[
        {
          value: 'list',
          label: <ListIcon />,
          'aria-label': t('map.view.list'),
          title: t('map.view.list'),
        },
        {
          value: 'map',
          label: <MapPinIcon />,
          'aria-label': t('map.view.map'),
          title: t('map.view.map'),
        },
      ]}
    />
  )
}

/** Every sort column, including the two without a table header, and the direction. */
function SortControl({ sort, onSort }: { sort: ListingSort; onSort: (sort: ListingSort) => void }) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm whitespace-nowrap text-fg-muted">
        {t('listings.sort.label')}
      </label>
      <Select
        id={id}
        size="sm"
        align="end"
        className="w-auto"
        value={sort.column}
        onValueChange={(column) => onSort(nextSort(sort, column))}
        options={ListingSortColumnSchema.options.map((column) => ({
          value: column,
          label: t(`listings.sort.column.${column}`),
        }))}
      />
      <SegmentedControl
        aria-label={t('listings.sort.direction')}
        size="sm"
        value={sort.direction}
        onValueChange={(direction) => onSort({ column: sort.column, direction })}
        segments={[
          {
            value: 'asc',
            label: <ArrowUpIcon />,
            'aria-label': t('listings.sort.asc'),
            title: t('listings.sort.asc'),
          },
          {
            value: 'desc',
            label: <ArrowDownIcon />,
            'aria-label': t('listings.sort.desc'),
            title: t('listings.sort.desc'),
          },
        ]}
      />
    </div>
  )
}
