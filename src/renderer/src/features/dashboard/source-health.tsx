import { useTranslation } from 'react-i18next'
import type { SourceCoverage } from '@shared/notifications'
import { Button } from '../../components/ui/button'
import { useApp } from '../../lib/app-context'
import { useFormat } from '../../lib/format'
import { displaySyncStatus } from '../listings/sync-summary'

export function SourceHealth({
  coverage,
  trackingStartedAt,
}: {
  coverage: readonly SourceCoverage[]
  /** When the app began telling new listings from the imported baseline. */
  trackingStartedAt: string | null
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const { navigate } = useApp()

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border">
        {coverage.map((source) => {
          const status = source.lastRun === null ? null : displaySyncStatus(source.lastRun)
          return (
            <li key={source.source} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <h3 className="text-sm font-medium">{t(`edictSource.${source.source}`)}</h3>
              <p className="text-xs text-fg-muted">
                {source.lastSuccessAt === null
                  ? t('dashboard.neverSynced')
                  : t('dashboard.lastSuccess', { time: format.timestamp(source.lastSuccessAt) })}
              </p>
              {status === 'failed' || status === 'degraded' || status === 'cancelled' ? (
                <p className="text-xs text-warning-text">
                  {t(
                    status === 'failed'
                      ? 'dashboard.syncFailed'
                      : status === 'degraded'
                        ? 'dashboard.syncDegraded'
                        : 'dashboard.syncCancelled',
                  )}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-col gap-1 text-xs text-fg-muted">
        <p>{t('dashboard.baseline')}</p>
        {trackingStartedAt !== null && (
          <p>{t('dashboard.trackingSince', { time: format.timestamp(trackingStartedAt) })}</p>
        )}
      </div>
      <Button
        className="self-start"
        variant="outline"
        size="sm"
        onClick={() => navigate({ screen: 'settings' })}
      >
        {t('dashboard.openSettings')}
      </Button>
    </div>
  )
}
