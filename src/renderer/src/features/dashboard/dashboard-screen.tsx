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
  RefreshIcon,
} from '../../components/ui/icons'
import { Page, PageHeader } from '../../components/ui/page'
import { Select } from '../../components/ui/select'
import { Skeleton } from '../../components/ui/skeleton'
import { Spinner } from '../../components/ui/spinner'
import { TILE, TILE_INTERACTIVE } from '../../components/ui/tile'
import { useApp } from '../../lib/app-context'
import { cx } from '../../lib/cx'
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
const LISTING_SECTIONS = [
  { section: 'new', items: 'newListings', key: 'new' },
  { section: 'upcoming', items: 'upcomingListings', key: 'upcoming' },
  { section: 'starred', items: 'starredListings', key: 'starred' },
] as const

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
    <Page>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        actions={
          <>
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
          </>
        }
      >
        {data !== null && (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <p>{t('dashboard.updatedAt', { time: format.timestamp(data.generatedAt) })}</p>
            {loading && <Spinner className="size-3" />}
          </div>
        )}
      </PageHeader>

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
              const count = data.counts[key]
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => openSection(section)}
                  className={cx(
                    TILE,
                    TILE_INTERACTIVE,
                    'group flex min-w-0 flex-col items-start gap-2 p-5 text-left active:bg-fill-muted',
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2 text-sm text-fg-muted">
                    {t(`dashboard.counts.${key}`)}
                    <ChevronRightIcon className="shrink-0 opacity-40 transition-opacity duration-120 group-hover:opacity-100" />
                  </span>
                  <span
                    className={cx(
                      'text-3xl font-semibold tracking-tight tabular-nums',
                      // A zero is information, not a headline.
                      count === 0 && 'text-fg-muted',
                    )}
                  >
                    {format.number(count)}
                  </span>
                </button>
              )
            })}
          </div>

          {firstImport && (
            <EmptyState
              icon={<InboxIcon />}
              title={t('dashboard.firstImportTitle')}
              description={t('dashboard.firstImportText')}
              className={TILE}
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
              {LISTING_SECTIONS.map(({ section, items, key }) => (
                <ListingSection
                  key={section}
                  title={t(`dashboard.${key}Title`)}
                  description={t(`dashboard.${key}Description`)}
                  empty={data[items].length === 0 ? t(`dashboard.${key}Empty`) : null}
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
              ))}
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
              <SourceHealth
                coverage={data.coverage}
                trackingStartedAt={data.trackingStartedAt}
                sync={sync}
              />
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
  /** Why the section has nothing to show, or null when it has listings. */
  empty: string | null
  action: ReactNode
  children: ReactNode
}

/**
 * A heading with its listings. An empty section shrinks to one quiet row, so
 * it does not push the sections that have something to show down the page.
 */
function ListingSection({ title, description, empty, action, children }: ListingSectionProps) {
  const titleId = useId()
  if (empty !== null) {
    return (
      <section
        aria-labelledby={titleId}
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border bg-bg-muted px-5 py-4"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-fg-muted">{empty}</p>
      </section>
    )
  }
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
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {SECTIONS.map((section) => (
          <Skeleton key={section} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
