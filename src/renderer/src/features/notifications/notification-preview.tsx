import { useTranslation } from 'react-i18next'
import type { NotificationSummary } from '@shared/notifications'
import { Badge } from '../../components/ui/badge'
import { useFormat } from '../../lib/format'

interface NotificationPreviewProps {
  notification: NotificationSummary
  onOpen: (notification: NotificationSummary) => void
}

export function NotificationPreview({ notification, onOpen }: NotificationPreviewProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const name =
    notification.presetKey === null
      ? notification.filterName
      : t(`filters.presets.${notification.presetKey}`)
  const partial = notification.coverage.some(
    (source) => source.lastSuccessAt === null || source.lastRun?.status !== 'ok',
  )
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className="flex w-full flex-col gap-2 rounded-md border border-border bg-surface p-4 text-left transition-colors duration-120 hover:border-border-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft"
    >
      <span className="flex w-full flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 font-medium wrap-break-word">{name}</span>
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
      <span className="text-xs text-fg-muted">
        {t('notifications.created', { time: format.timestamp(notification.createdAt) })}
      </span>
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
