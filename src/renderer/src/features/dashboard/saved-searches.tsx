import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DashboardSearch, ListingCollection } from '@shared/notifications'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { useApp } from '../../lib/app-context'
import { useFormat } from '../../lib/format'
import { AlertDialog } from '../notifications/alert-dialog'
import { SearchCriteriaSummary } from '../notifications/search-criteria-summary'

export function SavedSearches({
  searches,
  onOpen,
  onSaved,
}: {
  searches: readonly DashboardSearch[]
  onOpen: (collection: ListingCollection) => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const { settings, navigate } = useApp()
  const [editing, setEditing] = useState<DashboardSearch | null>(null)
  return (
    <>
      <ul className="grid gap-4 lg:grid-cols-2">
        {searches.map((search) => {
          const { filter, alert } = search
          const name =
            filter.presetKey === null ? filter.name : t(`filters.presets.${filter.presetKey}`)
          const partialScope =
            filter.query.sources.some((source) => !settings.syncSources.includes(source)) ||
            filter.query.bundeslaender.some((land) => !settings.syncBundeslaender.includes(land))
          return (
            <li
              key={filter.id}
              className="flex min-w-0 flex-col gap-4 rounded-md border border-border bg-bg-muted p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 text-base font-semibold wrap-break-word">{name}</h3>
                <Badge variant={alert.enabled ? 'primary' : 'default'} size="sm">
                  {!alert.enabled
                    ? t('dashboard.alertOff')
                    : alert.cadence === 'after_sync'
                      ? t('dashboard.alertAfterSync')
                      : t('dashboard.alertWaiting')}
                </Badge>
              </div>
              <SearchCriteriaSummary query={filter.query} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                <span>{t('dashboard.searchMatches', { count: search.matchCount })}</span>
                <span className="text-fg-muted">
                  {t('dashboard.searchNew', { count: search.newCount })}
                </span>
              </div>
              {alert.enabled && alert.nextDueAt !== null && (
                <p className="text-xs text-fg-muted">
                  {t('dashboard.alertNext', { time: format.timestamp(alert.nextDueAt) })}
                </p>
              )}
              {(!search.inScope || partialScope) && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <p className="text-warning-text">
                    {t(search.inScope ? 'dashboard.scopeWarning' : 'dashboard.outOfScope')}
                  </p>
                  <Button variant="link" onClick={() => navigate({ screen: 'settings' })}>
                    {t('dashboard.openSettings')}
                  </Button>
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onOpen({ kind: 'saved_searches', filterId: filter.id, section: 'all' })
                  }
                >
                  {t('dashboard.viewSearch')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(search)}>
                  {t(alert.enabled ? 'dashboard.editAlert' : 'dashboard.setUpAlert')}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {editing !== null && (
        <AlertDialog filter={editing.filter} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
    </>
  )
}
