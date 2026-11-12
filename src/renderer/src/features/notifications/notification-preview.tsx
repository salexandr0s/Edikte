import { useTranslation } from 'react-i18next'
import type { NotificationSummary } from '@shared/notifications'
import { Badge } from '../../components/ui/badge'
import { TILE, TILE_INTERACTIVE } from '../../components/ui/tile'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'

interface NotificationPreviewProps {
  notification: NotificationSummary
  onOpen: (notification: NotificationSummary) => void
  /** `tile` stands on the page; `row` is a line in a card's list. */
  variant?: 'tile' | 'row'
}

export function NotificationPreview({
  notification,
  onOpen,
  variant = 'tile',
}: NotificationPreviewProps) {
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
      className={cx(
        'flex w-full flex-col gap-1.5 text-left',
        variant === 'tile'
          ? `${TILE} ${TILE_INTERACTIVE} px-6 py-5`
          : 'rounded-md px-3 py-2 transition-colors duration-120 hover:bg-surface-hover',
      )}
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
