import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SavedFilter } from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import type { CollectionPage, ListingCollection, NotificationSummary } from '@shared/notifications'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { AlertCircleIcon, ChevronLeftIcon, SearchIcon } from '../../components/ui/icons'
import { Spinner } from '../../components/ui/spinner'
import { useApp, type CollectionOrigin } from '../../lib/app-context'
import { errorCode, invoke } from '../../lib/bridge'
import { useFormat } from '../../lib/format'
import { useBridgeEvent } from '../../lib/use-bridge-event'
import { OpportunityList } from './opportunity-list'

interface CollectionAnswer {
  collection: ListingCollection
  page: CollectionPage
  filters: SavedFilter[]
  notification: NotificationSummary | null
}

/** Shows current search collections or a digest's immutable membership. */
export function CollectionScreen({
  collection,
  origin,
}: {
  collection: ListingCollection
  origin: CollectionOrigin
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const { navigate } = useApp()
  const [answer, setAnswer] = useState<CollectionAnswer | null>(null)
  const [failure, setFailure] = useState<{
    collection: ListingCollection
    code: AppErrorCode
  } | null>(null)
  const [refreshes, setRefreshes] = useState(0)
  const [readRetries, setReadRetries] = useState(0)
  const [readFailure, setReadFailure] = useState<{
    collection: ListingCollection
    code: AppErrorCode
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const reload = () => setRefreshes((value) => value + 1)
  const data = answer?.collection === collection ? answer : null
  const error = failure?.collection === collection ? failure.code : null
  const readError = readFailure?.collection === collection ? readFailure.code : null
  const historical = collection.kind === 'notification'
  const title = historical
    ? t('collections.notificationTitle')
    : collection.kind === 'saved_searches'
      ? t(`collections.sections.${collection.section}`)
      : t('collections.title')

  useEffect(() => {
    let ignore = false
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        Promise.all([
          invoke('listings:queryCollection', collection),
          invoke('filters:list'),
          collection.kind === 'notification'
            ? invoke('notifications:get', { id: collection.notificationId })
            : Promise.resolve(null),
        ]).then(
          ([page, filters, detail]) => {
            if (ignore) return
            setAnswer({ collection, page, filters, notification: detail?.notification ?? null })
            setFailure(null)
            setLoading(false)
          },
          (reason: unknown) => {
            if (ignore) return
            setFailure({ collection, code: errorCode(reason) })
            setLoading(false)
          },
        )
      },
      refreshes === 0 ? 0 : 100,
    )
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [collection, refreshes])

  useEffect(() => {
    if (collection.kind !== 'notification') return
    let ignore = false
    invoke('notifications:markRead', { id: collection.notificationId }).then(
      () => {
        if (!ignore) setReadFailure(null)
      },
      (reason: unknown) => {
        if (!ignore) setReadFailure({ collection, code: errorCode(reason) })
      },
    )
    return () => {
      ignore = true
    }
  }, [collection, readRetries])

  useBridgeEvent('listings:changed', reload)
  useBridgeEvent('filters:changed', reload)

  const names = new Map(
    (data?.filters ?? []).map((filter) => [
      filter.id,
      filter.presetKey === null ? filter.name : t(`filters.presets.${filter.presetKey}`),
    ]),
  )
  const searchNames =
    collection.kind === 'saved_searches' && collection.filterId !== null
      ? names.get(collection.filterId)
      : null

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-4">
        <div className="self-start">
          <Button variant="ghost" size="sm" onClick={() => navigate({ screen: origin })}>
            <ChevronLeftIcon />
            {t(
              origin === 'dashboard'
                ? 'collections.backDashboard'
                : 'collections.backNotifications',
            )}
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
            {title}
          </h1>
          {data?.notification !== null && data?.notification !== undefined ? (
            <>
              <p className="text-base font-medium wrap-break-word">
                {data.notification.presetKey === null
                  ? data.notification.filterName
                  : t(`filters.presets.${data.notification.presetKey}`)}
              </p>
              <p className="text-sm text-fg-muted">
                {t('collections.period', {
                  from: format.timestamp(data.notification.periodFrom),
                  to: format.timestamp(data.notification.periodTo),
                })}
              </p>
            </>
          ) : collection.kind === 'saved_searches' ? (
            <p className="text-sm text-fg-muted">{searchNames ?? t('collections.allSearches')}</p>
          ) : null}
          {historical && (
            <p className="max-w-3xl text-sm text-fg-muted">{t('collections.historical')}</p>
          )}
        </div>
      </header>

      {readError !== null && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p className="min-w-0 flex-1 text-danger-text">
            {t('collections.markReadFailed')} {t(`errors.${readError}`)}
          </p>
          <Button variant="outline" size="sm" onClick={() => setReadRetries((value) => value + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {data === null ? (
        error === null ? (
          <div className="flex justify-center py-16">
            <Spinner label={t('common.loading')} />
          </div>
        ) : (
          <EmptyState
            icon={<AlertCircleIcon />}
            title={t('collections.loadFailed')}
            description={t(`errors.${error}`)}
            action={
              <Button variant="outline" onClick={reload}>
                {t('common.retry')}
              </Button>
            }
          />
        )
      ) : (
        <>
          <div aria-live="polite" className="flex items-center gap-2 text-sm text-fg-muted">
            <p>{t('collections.count', { count: data.page.total })}</p>
            {loading && <Spinner className="size-3.5" />}
          </div>
          {error !== null && (
            <p role="alert" className="text-sm text-danger-text">
              {t('collections.updateFailed')} {t(`errors.${error}`)}
            </p>
          )}
          {data.page.items.length === 0 ? (
            <EmptyState
              icon={<SearchIcon />}
              title={t('collections.emptyTitle')}
              description={t('collections.emptyText')}
            />
          ) : (
            <OpportunityList
              items={data.page.items}
              filterNames={names}
              historical={historical}
              showBothPrices={collection.kind === 'saved_searches' && collection.filterId === null}
              onOpen={(item) =>
                navigate({
                  screen: 'detail',
                  id: item.current?.id ?? item.listing.id,
                  origin: 'collection',
                })
              }
            />
          )}
        </>
      )}
    </div>
  )
}
