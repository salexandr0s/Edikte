import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CollectionItem, CollectionSection, ListingCollection } from '@shared/notifications'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/empty-state'
import { AlertCircleIcon, BookmarkIcon, InboxIcon, RefreshIcon } from '../../components/ui/icons'
import { Select } from '../../components/ui/select'
import { Skeleton } from '../../components/ui/skeleton'
import { Spinner } from '../../components/ui/spinner'
import { useApp } from '../../lib/app-context'
import { useFormat } from '../../lib/format'
import { OpportunityList } from '../collections/opportunity-list'
import { useSync } from '../listings/use-sync'
import { NotificationPreview } from '../notifications/notification-preview'
import { SavedSearches } from './saved-searches'
import { SourceHealth } from './source-health'
import { useDashboard } from './use-dashboard'

const SECTIONS = ['all', 'new', 'upcoming', 'starred'] as const
const COUNT_KEYS = {
  all: 'matching',
  new: 'new',
  upcoming: 'upcoming',
  starred: 'starred',
} as const

/** Stays mounted under details so the selected saved search survives navigation. */
export function DashboardScreen() {
  const { t } = useTranslation()
  const format = useFormat()
  const { navigate } = useApp()
  const [filterId, setFilterId] = useState<number | null>(null)
  const { data, error, loading, reload } = useDashboard(filterId)
  const sync = useSync()
  const running = sync.status !== null && sync.status.state !== 'idle'
  const openCollection = (collection: ListingCollection) =>
    navigate({ screen: 'collection', collection, origin: 'dashboard' })
  const openSection = (section: CollectionSection) =>
    openCollection({ kind: 'saved_searches', filterId, section })
  const openListing = (item: CollectionItem) =>
    navigate({ screen: 'detail', id: item.current?.id ?? item.listing.id, origin: 'dashboard' })
  const filterNames = new Map(
    (data?.searches ?? []).map(({ filter }) => [
      filter.id,
      filter.presetKey === null ? filter.name : t(`filters.presets.${filter.presetKey}`),
    ]),
  )
  const firstImport =
    data !== null &&
    data.totalInScope === 0 &&
    data.coverage.every((item) => item.lastSuccessAt === null)

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
            {t('dashboard.title')}
          </h1>
          <p className="text-sm text-fg-muted">{t('dashboard.description')}</p>
        </div>
        <div className="flex max-w-full items-center gap-3">
          <Select
            value={filterId === null ? 'all' : String(filterId)}
            aria-label={t('dashboard.searchLabel')}
            className="w-auto max-w-full"
            options={[
              { value: 'all', label: t('dashboard.allSearches') },
              ...[...filterNames].map(([id, name]) => ({ value: String(id), label: name })),
            ]}
            onValueChange={(value) => setFilterId(value === 'all' ? null : Number(value))}
          />
          <Button
            variant="outline"
            loading={running || sync.pending === 'start'}
            onClick={() => {
              sync.start()
              reload()
            }}
          >
            <RefreshIcon />
            {t('dashboard.refresh')}
          </Button>
        </div>
      </header>

      {data === null ? (
        error === null ? (
          <DashboardSkeleton />
        ) : (
          <EmptyState
            icon={<AlertCircleIcon />}
            title={t('dashboard.loadFailed')}
            description={t(`errors.${error}`)}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={reload}>
                  {t('common.retry')}
                </Button>
                {filterId !== null && (
                  <Button variant="ghost" onClick={() => setFilterId(null)}>
                    {t('dashboard.allSearches')}
                  </Button>
                )}
              </div>
            }
          />
        )
      ) : (
        <>
          {error !== null && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-bg-muted px-4 py-3 text-sm"
            >
              <p className="min-w-0 flex-1 text-danger-text">
                {t('dashboard.updateFailed')} {t(`errors.${error}`)}
              </p>
              <Button variant="outline" size="sm" onClick={reload}>
                {t('common.retry')}
              </Button>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4" aria-busy={loading}>
            {SECTIONS.map((section) => {
              const key = COUNT_KEYS[section]
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => openSection(section)}
                  className="flex min-w-0 flex-col items-start gap-2 rounded-lg border border-border bg-surface p-5 text-left shadow-xs transition-colors duration-120 hover:border-border-strong hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring-soft focus-visible:outline-none active:bg-fill-muted"
                >
                  <span className="text-sm text-fg-muted">{t(`dashboard.counts.${key}`)}</span>
                  <span className="text-3xl font-semibold tracking-tight tabular-nums">
                    {format.number(data.counts[key])}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            {loading && <Spinner className="size-3.5" />}
            <p>{t('dashboard.updatedAt', { time: format.timestamp(data.generatedAt) })}</p>
          </div>

          {firstImport && (
            <EmptyState
              icon={<InboxIcon />}
              title={t('dashboard.firstImportTitle')}
              description={t('dashboard.firstImportText')}
              className="rounded-lg border border-border bg-surface"
              action={
                <Button loading={running || sync.pending === 'start'} onClick={sync.start}>
                  <RefreshIcon />
                  {t('dashboard.refresh')}
                </Button>
              }
            />
          )}

          {data.searches.length === 0 ? (
            <EmptyState
              icon={<BookmarkIcon />}
              title={t('dashboard.noSearchesTitle')}
              description={t('dashboard.noSearchesText')}
              action={
                <Button onClick={() => navigate({ screen: 'listings' })}>
                  {t('dashboard.browse')}
                </Button>
              }
            />
          ) : (
            <>
              <Card
                title={t('dashboard.newTitle')}
                description={t('dashboard.newDescription')}
                actions={
                  <Button variant="link" onClick={() => openSection('new')}>
                    {t('dashboard.viewAll')}
                  </Button>
                }
              >
                <div className="flex flex-col gap-4">
                  {data.newListings.length === 0 ? (
                    <p className="text-sm text-fg-muted">{t('dashboard.newEmpty')}</p>
                  ) : (
                    <OpportunityList
                      items={data.newListings}
                      onOpen={openListing}
                      filterNames={filterNames}
                      showBothPrices={filterId === null}
                    />
                  )}
                  <p className="text-xs text-fg-muted">{t('dashboard.baseline')}</p>
                  {data.trackingStartedAt !== null && (
                    <p className="text-xs text-fg-muted">
                      {t('dashboard.trackingSince', {
                        time: format.timestamp(data.trackingStartedAt),
                      })}
                    </p>
                  )}
                </div>
              </Card>

              <Card
                title={t('dashboard.upcomingTitle')}
                description={t('dashboard.upcomingDescription')}
                actions={
                  <Button variant="link" onClick={() => openSection('upcoming')}>
                    {t('dashboard.viewAll')}
                  </Button>
                }
              >
                {data.upcomingListings.length === 0 ? (
                  <p className="text-sm text-fg-muted">{t('dashboard.upcomingEmpty')}</p>
                ) : (
                  <OpportunityList
                    items={data.upcomingListings}
                    onOpen={openListing}
                    filterNames={filterNames}
                    showBothPrices={filterId === null}
                  />
                )}
              </Card>
              <Card
                title={t('dashboard.starredTitle')}
                description={t('dashboard.starredDescription')}
                actions={
                  <Button variant="link" onClick={() => openSection('starred')}>
                    {t('dashboard.viewAll')}
                  </Button>
                }
              >
                {data.starredListings.length === 0 ? (
                  <p className="text-sm text-fg-muted">{t('dashboard.starredEmpty')}</p>
                ) : (
                  <OpportunityList
                    items={data.starredListings}
                    onOpen={openListing}
                    filterNames={filterNames}
                    showBothPrices={filterId === null}
                  />
                )}
              </Card>
              <Card
                title={t('dashboard.searchesTitle')}
                description={t('dashboard.searchesDescription')}
              >
                <SavedSearches searches={data.searches} onOpen={openCollection} onSaved={reload} />
              </Card>
            </>
          )}

          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card
              title={t('dashboard.recentTitle')}
              actions={
                <Button variant="link" onClick={() => navigate({ screen: 'notifications' })}>
                  {t('dashboard.allNotifications')}
                </Button>
              }
            >
              {data.notifications.length === 0 ? (
                <p className="text-sm text-fg-muted">{t('dashboard.recentEmpty')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.notifications.map((notification) => (
                    <li key={notification.id}>
                      <NotificationPreview
                        notification={notification}
                        onOpen={(item) =>
                          openCollection({ kind: 'notification', notificationId: item.id })
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card
              title={t('dashboard.freshnessTitle')}
              description={t('dashboard.freshnessDescription')}
            >
              <SourceHealth coverage={data.coverage} sync={sync} />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function DashboardSkeleton() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {SECTIONS.map((section) => (
          <Skeleton key={section} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
