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
      <ul className="flex flex-col divide-y divide-border">
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
              className="flex flex-wrap items-start gap-x-6 gap-y-3 py-5 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-1 basis-80 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="min-w-0 text-base font-semibold wrap-break-word">{name}</h3>
                  <Badge variant={alert.enabled ? 'primary' : 'default'} size="sm">
                    {!alert.enabled
                      ? t('dashboard.alertOff')
                      : alert.cadence === 'after_sync'
                        ? t('dashboard.alertAfterSync')
                        : t('dashboard.alertWaiting')}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                  <span>{t('dashboard.searchMatches', { count: search.matchCount })}</span>
                  <span className="text-fg-muted">
                    {t('dashboard.searchNew', { count: search.newCount })}
                  </span>
                </div>
                <SearchCriteriaSummary query={filter.query} />
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
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
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
