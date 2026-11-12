import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppErrorCode } from '@shared/errors'
import type {
  DeliveryStatus,
  NotificationListPage,
  NotificationSummary,
} from '@shared/notifications'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/empty-state'
import { AlertCircleIcon, BellIcon, RefreshIcon } from '../../components/ui/icons'
import { Page, PageHeader } from '../../components/ui/page'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Spinner } from '../../components/ui/spinner'
import { useToast } from '../../components/ui/toast'
import { useApp } from '../../lib/app-context'
import { errorCode, invoke } from '../../lib/bridge'
import { useFormat } from '../../lib/format'
import { useBridgeEvent } from '../../lib/use-bridge-event'
import { NotificationPreview } from './notification-preview'

export function NotificationsScreen() {
  const { t } = useTranslation()
  const { navigate } = useApp()
  const toast = useToast()
  const [mode, setMode] = useState<'all' | 'unread'>('all')
  const [page, setPage] = useState<NotificationListPage | null>(null)
  const [failure, setFailure] = useState<AppErrorCode | null>(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [more, setMore] = useState(false)
  const [marking, setMarking] = useState(false)
  const request = useRef(0)
  const reload = () => {
    setLoading(true)
    setMore(false)
    setRefresh((value) => value + 1)
  }
  function selectMode(next: 'all' | 'unread') {
    if (next === mode) return
    setMode(next)
    setPage(null)
    setFailure(null)
    setLoading(true)
    setMore(false)
  }
  useBridgeEvent('notifications:changed', reload)

  useEffect(() => {
    const version = ++request.current
    invoke('notifications:list', { unreadOnly: mode === 'unread', limit: 25 }).then(
      (result) => {
        if (request.current !== version) return
        setPage(result)
        setFailure(null)
        setLoading(false)
      },
      (error: unknown) => {
        if (request.current !== version) return
        setFailure(errorCode(error))
        setLoading(false)
      },
    )
    return () => {
      request.current += 1
    }
  }, [mode, refresh])

  async function loadMore() {
    if (page?.nextCursor == null || more) return
    const version = request.current
    setMore(true)
    try {
      const next = await invoke('notifications:list', {
        unreadOnly: mode === 'unread',
        beforeId: page.nextCursor,
        limit: 25,
      })
      if (request.current !== version) return
      setPage((current) =>
        current === null ? next : { ...next, items: [...current.items, ...next.items] },
      )
      setFailure(null)
    } catch (error) {
      if (request.current === version) setFailure(errorCode(error))
    } finally {
      if (request.current === version) setMore(false)
    }
  }

  async function markAll() {
    setMarking(true)
    try {
      await invoke('notifications:markAllRead')
      reload()
    } catch (error) {
      toast({
        kind: 'error',
        title: t('notifications.markFailed'),
        description: t(`errors.${errorCode(error)}`),
      })
    } finally {
      setMarking(false)
    }
  }

  function open(notification: NotificationSummary) {
    navigate({
      screen: 'collection',
      collection: { kind: 'notification', notificationId: notification.id },
      origin: 'notifications',
    })
    void invoke('notifications:markRead', { id: notification.id }).catch((error: unknown) =>
      toast({
        kind: 'error',
        title: t('notifications.markFailed'),
        description: t(`errors.${errorCode(error)}`),
      }),
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.description')}
        actions={
          <Button
            variant="outline"
            loading={marking}
            disabled={page === null || page.unreadCount === 0}
            onClick={() => void markAll()}
          >
            {t('notifications.markAllRead')}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label={t('notifications.filter')}
          value={mode}
          onValueChange={selectMode}
          size="sm"
          segments={[
            { value: 'all', label: t('notifications.all') },
            { value: 'unread', label: t('notifications.unread') },
          ]}
        />
        <Button variant="ghost" size="sm" loading={loading} onClick={reload}>
          <RefreshIcon />
          {t('notifications.refresh')}
        </Button>
      </div>
      {failure !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-danger-subtle bg-danger-subtle/40 p-4 text-sm"
        >
          <AlertCircleIcon className="text-danger-text" />
          <p className="min-w-0 flex-1">
            {t('notifications.loadFailed')} {t(`errors.${failure}`)}
          </p>
          <Button variant="outline" size="sm" onClick={reload}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {page === null ? (
        failure === null && (
          <div className="flex justify-center py-12">
            <Spinner label={t('common.loading')} />
          </div>
        )
      ) : page.items.length === 0 ? (
        <EmptyState
          className="rounded-lg border border-border bg-surface"
          icon={<BellIcon />}
          title={t(mode === 'unread' ? 'notifications.noUnread' : 'notifications.empty')}
          description={t(
            mode === 'unread' ? 'notifications.noUnreadHelp' : 'notifications.emptyHelp',
          )}
          action={
            mode === 'all' ? (
              <Button variant="outline" onClick={() => navigate({ screen: 'dashboard' })}>
                {t('notifications.openDashboard')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3" aria-busy={loading}>
          {page.items.map((notification) => (
            <NotificationPreview key={notification.id} notification={notification} onOpen={open} />
          ))}
          {page.nextCursor !== null && (
            <Button
              variant="outline"
              className="self-center"
              loading={more}
              disabled={loading}
              onClick={() => void loadMore()}
            >
              {t('notifications.loadMore')}
            </Button>
          )}
        </div>
      )}
      <DesktopDelivery />
    </Page>
  )
}

function DesktopDelivery() {
  const { t } = useTranslation()
  const format = useFormat()
  const [status, setStatus] = useState<DeliveryStatus | null>(null)
  const [failure, setFailure] = useState<AppErrorCode | null>(null)
  const [testing, setTesting] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useBridgeEvent('notifications:changed', () => setRefresh((value) => value + 1))
  useEffect(() => {
    let ignore = false
    invoke('notifications:deliveryStatus').then(
      (value) => {
        if (!ignore) {
          setStatus(value)
          setFailure(null)
        }
      },
      (error: unknown) => {
        if (!ignore) setFailure(errorCode(error))
      },
    )
    return () => {
      ignore = true
    }
  }, [refresh])
  async function test() {
    setTesting(true)
    setFailure(null)
    try {
      setStatus(await invoke('notifications:testDesktop'))
    } catch (error) {
      setFailure(errorCode(error))
    } finally {
      setTesting(false)
    }
  }
  return (
    <Card
      title={t('notifications.delivery.title')}
      description={t('notifications.delivery.help')}
      actions={
        <Button
          variant="outline"
          size="sm"
          loading={testing}
          disabled={status !== null && !status.supported}
          onClick={() => void test()}
        >
          {t('notifications.delivery.test')}
        </Button>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {status !== null && (
          <p>
            {!status.supported
              ? t('notifications.delivery.unsupported')
              : t(`notifications.delivery.${status.lastStatus}`)}
          </p>
        )}
        {status?.lastAttemptAt != null && (
          <p className="text-xs text-fg-muted">
            {t('notifications.delivery.lastAttempt', {
              time: format.timestamp(status.lastAttemptAt),
            })}
          </p>
        )}
        {status?.lastStatus === 'failed' && (
          <p className="text-xs text-fg-muted">{t('notifications.delivery.settingsHelp')}</p>
        )}
        {failure !== null && (
          <p role="alert" className="text-danger-text">
            {t('notifications.delivery.loadFailed')} {t(`errors.${failure}`)}
          </p>
        )}
        {status === null && failure === null && <Spinner label={t('common.loading')} />}
      </div>
    </Card>
  )
}
