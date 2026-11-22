import { useTranslation } from 'react-i18next'
import type { NotificationSummary } from '@shared/notifications'
import { Badge } from '../../components/ui/badge'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { displaySyncStatus } from '../listings/sync-summary'

interface NotificationPreviewProps {
  notification: NotificationSummary
  onOpen: (notification: NotificationSummary) => void
  /** Dashboard previews use compact padding. */
  variant?: 'inbox' | 'row'
}

export function NotificationPreview({
  notification,
  onOpen,
  variant = 'inbox',
}: NotificationPreviewProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const name =
    notification.presetKey === null
      ? notification.filterName
      : t(`filters.presets.${notification.presetKey}`)
  const partial = notification.coverage.some(
    (source) =>
      source.lastSuccessAt === null ||
      source.lastRun === null ||
      displaySyncStatus(source.lastRun) !== 'ok',
  )
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={cx(
        'flex w-full flex-col gap-1.5 rounded-md text-left transition-colors duration-120 hover:bg-surface-hover focus-visible:bg-surface-hover',
        variant === 'row' ? 'px-3 py-2' : 'px-4 py-4',
      )}
    >
      <span className="flex w-full flex-wrap items-start justify-between gap-2">
        <span
          className={cx(
            'min-w-0 wrap-break-word',
            notification.readAt === null ? 'font-semibold' : 'font-medium',
          )}
        >
          {name}
        </span>
        {notification.readAt === null && (
          <Badge variant="primary" size="sm">
            {t('notifications.unread')}
          </Badge>
        )}
      </span>
      <span className="text-sm">
        {t('notifications.matchCount', { count: notification.count })}
      </span>
      <span className="text-xs text-fg-muted">
        {t('notifications.period', {
          from: format.timestamp(notification.periodFrom),
          to: format.timestamp(notification.periodTo),
        })}
      </span>
      <time dateTime={notification.createdAt} className="text-xs text-fg-muted">
        {t('notifications.created', { time: format.timestamp(notification.createdAt) })}
      </time>
      {partial && (
        <span className="text-xs text-warning-text">{t('notifications.partialCoverage')}</span>
      )}
      {(notification.desktopStatus === 'failed' ||
        notification.desktopStatus === 'unsupported') && (
        <span className="text-xs text-fg-muted">
          {t(`notifications.attempt.${notification.desktopStatus}`)}
        </span>
      )}
    </button>
  )
}
