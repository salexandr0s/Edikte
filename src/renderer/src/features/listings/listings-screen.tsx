import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListingQuery } from '@shared/domain'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { FilterIcon } from '../../components/ui/icons'
import { useApp } from '../../lib/app-context'
import { ActiveFilterChips } from './active-filter-chips'
import { AnalysisQueueStatus, AnalyzeFilteredButton } from './analysis-actions'
import { FillAreasButton, FillProgressPanel, useFillJob } from './fill-areas'
import { FilterDialog } from './filter-dialog'
import { ListingResults } from './listing-results'
import { applyPatch, countActiveFilters, defaultQuery, resetFilters } from './query-helpers'
import { SavedFilters } from './saved-filters'
import { SyncBar } from './sync-bar'
import { useAnalysisTracker } from './use-analysis-tracker'
import { useListingPage } from './use-listing-page'
import { useSync } from './use-sync'
import { useUserState } from './use-user-state'

/**
 * The auction list. The shell keeps this screen mounted while a listing or
 * Settings is open, so the query lives here and survives navigation. The
 * filters open in a dialog over the list; the chips under the toolbar show
 * which ones are in force.
 */
export function ListingsScreen() {
  const { t } = useTranslation()
  const { settings, navigate } = useApp()
  const [query, setQuery] = useState(() => defaultQuery(settings.priceBasis))
  // A new default price basis from Settings applies to the current list.
  const [priceBasis, setPriceBasis] = useState(settings.priceBasis)
  if (settings.priceBasis !== priceBasis) {
    setPriceBasis(settings.priceBasis)
    setQuery((current) => applyPatch(current, { priceBasis: settings.priceBasis }))
  }
  const [filtersOpen, setFiltersOpen] = useState(false)
  const titleId = useId()

  const listing = useListingPage(query)
  const userState = useUserState(listing, query)
  const tracker = useAnalysisTracker()
  const sync = useSync()
  const fill = useFillJob(query)
  const activeFilters = countActiveFilters(query)

  const updateQuery = (patch: Partial<ListingQuery>) =>
    setQuery((current) => applyPatch(current, patch))
  const reset = () => setQuery((current) => resetFilters(current, settings.priceBasis))

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <h1
          id={titleId}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          {t('listings.title')}
        </h1>
        <SyncBar sync={sync} />
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterDialog
            trigger={
              <Button variant="outline" size="sm">
                <FilterIcon />
                {t('filters.title')}
                {activeFilters > 0 && (
                  <Badge size="sm" variant="primary" className="-mr-1">
                    {t('filters.activeCount', { count: activeFilters })}
                  </Badge>
                )}
              </Button>
            }
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            query={query}
            onChange={updateQuery}
            onReset={reset}
            activeCount={activeFilters}
            matches={listing.page === null ? null : userState.rows.length}
            loading={listing.loading}
          />
          <SavedFilters query={query} onApply={setQuery} />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <AnalysisQueueStatus rows={userState.rows} tracker={tracker} />
            <FillAreasButton job={fill} />
            <AnalyzeFilteredButton rows={userState.rows} tracker={tracker} />
          </div>
        </div>
        <ActiveFilterChips query={query} onChange={updateQuery} onReset={reset} />
      </div>

      <FillProgressPanel job={fill} />

      <ListingResults
        titleId={titleId}
        query={query}
        state={listing}
        rows={userState.rows}
        tracker={tracker}
        sync={sync}
        onSort={(sort) => updateQuery({ sort })}
        onReset={reset}
        onOpen={(row) => navigate({ screen: 'detail', id: row.id })}
        onStar={userState.star}
        onToggleHidden={userState.toggleHidden}
      />
    </div>
  )
}
