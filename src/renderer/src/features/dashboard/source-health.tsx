import { useTranslation } from 'react-i18next'
import type { SourceCoverage } from '@shared/notifications'
import { Button } from '../../components/ui/button'
import { RefreshIcon } from '../../components/ui/icons'
import { ProgressBar } from '../../components/ui/progress-bar'
import { useApp } from '../../lib/app-context'
import { useFormat } from '../../lib/format'
import type { SyncControls } from '../listings/use-sync'

export function SourceHealth({
  coverage,
  trackingStartedAt,
  sync,
}: {
  coverage: readonly SourceCoverage[]
  /** When the app began telling new listings from the imported baseline. */
  trackingStartedAt: string | null
  sync: SyncControls
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const { navigate } = useApp()
  const running = sync.status !== null && sync.status.state !== 'idle'

  return (
    <div className="flex flex-col gap-4">
      {running && sync.status !== null && (
        <div role="status" className="flex flex-col gap-2 text-sm">
          <p>{t('dashboard.syncing')}</p>
          {sync.status.total > 0 && (
            <ProgressBar
              value={sync.status.done}
              max={sync.status.total}
              label={t('dashboard.syncProgress', {
                done: format.number(sync.status.done),
                total: format.number(sync.status.total),
              })}
            />
          )}
        </div>
      )}
      {sync.error !== null && (
        <p role="alert" className="text-sm text-danger-text">
          {t('dashboard.syncStatusFailed')} {t(`errors.${sync.error}`)}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {coverage.map((source) => {
          const status = source.lastRun?.status
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
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          loading={running || sync.pending === 'start'}
          onClick={sync.start}
        >
          <RefreshIcon />
          {t('dashboard.refresh')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate({ screen: 'settings' })}>
          {t('dashboard.openSettings')}
        </Button>
      </div>
    </div>
  )
}
