import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { CollectionItem, CollectionSection, ListingCollection } from '@shared/notifications'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/empty-state'
import {
  AlertCircleIcon,
  BookmarkIcon,
  ChevronRightIcon,
  InboxIcon,
} from '../../components/ui/icons'
import { Page, PageHeader } from '../../components/ui/page'
import { Select } from '../../components/ui/select'
import { Skeleton } from '../../components/ui/skeleton'
import { Spinner } from '../../components/ui/spinner'
import { TILE } from '../../components/ui/tile'
import { useApp } from '../../lib/app-context'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { OpportunityList } from '../collections/opportunity-list'
import { SyncBar } from '../listings/sync-bar'
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
const LISTING_SECTIONS = [
  { section: 'new', items: 'newListings', key: 'new' },
  { section: 'upcoming', items: 'upcomingListings', key: 'upcoming' },
  { section: 'starred', items: 'starredListings', key: 'starred' },
] as const

/** Stays mounted under details so the selected saved search survives navigation. */
export function DashboardScreen() {
  const { t } = useTranslation()
  const format = useFormat()
  const { navigate, view, settings } = useApp()
  const active = view.screen === 'dashboard'
  const [filterId, setFilterId] = useState<number | null>(null)
  const { data, searches, error, loading, reload } = useDashboard(filterId, active)
  const sync = useSync(active)
  const searchLabelId = useId()
  const openCollection = (collection: ListingCollection) =>
    navigate({ screen: 'collection', collection, origin: 'dashboard' })
  const openSection = (section: CollectionSection) =>
    openCollection({ kind: 'saved_searches', filterId, section })
  const openListing = (item: CollectionItem) =>
    navigate({ screen: 'detail', id: item.current?.id ?? item.listing.id, origin: 'dashboard' })
  const filterNames = new Map(
    searches.map(({ filter }) => [
      filter.id,
      filter.presetKey === null ? filter.name : t(`filters.presets.${filter.presetKey}`),
    ]),
  )
  const firstImport =
    data !== null &&
    data.totalInScope === 0 &&
    data.coverage.every((item) => item.lastSuccessAt === null)

  return (
    <Page>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        actions={!firstImport && <SyncBar sync={sync} sources={settings.syncSources} />}
      />

      {firstImport && (
        <section
          className={cx(
            TILE,
            'flex flex-wrap items-center justify-between gap-6 border-l-4 border-l-accent-fill p-6',
          )}
        >
          <div className="flex min-w-0 flex-1 basis-80 items-start gap-4">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-text"
            >
              <InboxIcon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">
                {t('dashboard.firstImportTitle')}
              </h2>
              <p className="max-w-lg text-sm text-fg-muted">{t('dashboard.firstImportText')}</p>
            </div>
          </div>
          <SyncBar sync={sync} sources={settings.syncSources} />
        </section>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 max-w-full items-center gap-3">
            <label htmlFor={searchLabelId} className="shrink-0 text-sm font-medium">
              {t('dashboard.searchLabel')}
            </label>
            <Select
              id={searchLabelId}
              size="sm"
              value={filterId === null ? 'all' : String(filterId)}
              className="min-w-0 max-w-full"
              options={[
                { value: 'all', label: t('dashboard.allSearches') },
                ...[...filterNames].map(([id, name]) => ({ value: String(id), label: name })),
              ]}
              onValueChange={(value) => setFilterId(value === 'all' ? null : Number(value))}
            />
          </div>
          {data !== null && (
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              {t('dashboard.updatedAt', { time: format.timestamp(data.generatedAt) })}
              {loading && <Spinner className="size-3" />}
            </p>
          )}
        </div>
        {data !== null && (
          <div
            className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border shadow-xs md:grid-cols-4"
            aria-busy={loading}
          >
            {SECTIONS.map((section) => {
              const key = COUNT_KEYS[section]
              const count = data.counts[key]
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => openSection(section)}
                  className={cx(
                    'group flex min-w-0 flex-col items-start gap-2 px-5 py-4 text-left transition-colors duration-120 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring',
                    section === 'all'
                      ? 'bg-accent-soft text-accent-text hover:bg-accent-subtle active:bg-accent-soft'
                      : 'bg-surface hover:bg-surface-hover active:bg-fill-muted',
                  )}
                >
                  <span className="flex w-full items-start justify-between gap-2 text-sm font-medium">
                    {t(`dashboard.counts.${key}`)}
                    <ChevronRightIcon className="mt-0.5 shrink-0 text-fg-muted transition-colors group-hover:text-accent-text" />
                  </span>
                  <span
                    className={cx(
                      'text-3xl font-semibold tracking-tight tabular-nums',
                      count === 0 && section !== 'all' && 'text-fg-muted',
                    )}
                  >
                    {format.number(count)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

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
              {LISTING_SECTIONS.filter(({ items }) => data[items].length > 0).map(
                ({ section, items, key }) => (
                  <ListingSection
                    key={section}
                    title={t(`dashboard.${key}Title`)}
                    description={t(`dashboard.${key}Description`)}
                    action={
                      <Button variant="link" onClick={() => openSection(section)}>
                        {t('dashboard.viewAll')}
                      </Button>
                    }
                  >
                    <OpportunityList
                      items={data[items]}
                      onOpen={openListing}
                      filterNames={filterNames}
                      showBothPrices={filterId === null}
                    />
                  </ListingSection>
                ),
              )}
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
                <ul className="-mx-3 -my-2 flex flex-col gap-1">
                  {data.notifications.map((notification) => (
                    <li key={notification.id}>
                      <NotificationPreview
                        variant="row"
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
              <SourceHealth coverage={data.coverage} trackingStartedAt={data.trackingStartedAt} />
            </Card>
          </div>
        </>
      )}
    </Page>
  )
}

interface ListingSectionProps {
  title: string
  description: string
  action: ReactNode
  children: ReactNode
}

function ListingSection({ title, description, action, children }: ListingSectionProps) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-fg-muted">{description}</p>
        </div>
        <div className="shrink-0">{action}</div>
      </header>
      {children}
    </section>
  )
}

function DashboardSkeleton() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-6">
      <Skeleton className="h-24 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
