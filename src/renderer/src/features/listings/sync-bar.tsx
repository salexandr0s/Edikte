import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncRunSummary, SyncStatus } from '@shared/domain'
import { Badge, type BadgeVariant } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { AlertIcon, RefreshIcon } from '../../components/ui/icons'
import { ProgressBar } from '../../components/ui/progress-bar'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import type { SyncControls } from './use-sync'

const RUN_VARIANT: Readonly<Record<SyncRunSummary['status'], BadgeVariant>> = {
  running: 'primary',
  ok: 'success',
  degraded: 'warning',
  failed: 'danger',
  cancelled: 'default',
}

/** The running sync with its progress, or the last finished run, and the matching action. */
export function SyncBar({ sync }: { sync: SyncControls }) {
  const { t } = useTranslation()
  const { status } = sync
  const active = status !== null && status.state !== 'idle'

  return (
    <div className="flex min-w-0 items-center gap-4">
      <SyncAnnouncement status={status} />
      <div className="flex min-w-0 flex-col items-end gap-1.5 text-right">
        {active ? <RunningSync status={status} /> : <LastRun sync={sync} />}
      </div>
      {active ? (
        <Button
          variant="outline"
          size="sm"
          loading={sync.pending === 'cancel'}
          disabled={status.state === 'cancelling'}
          onClick={sync.cancel}
        >
          {status.state === 'cancelling' ? t('sync.cancelling') : t('common.cancel')}
        </Button>
      ) : (
        <Button size="sm" loading={sync.pending === 'start'} onClick={sync.start}>
          <RefreshIcon />
          {t('sync.now')}
        </Button>
      )}
    </div>
  )
}

/**
 * Tells screen readers when a sync starts, reaches the next phase and ends.
 * The counts stay on screen only, so the region does not speak every step.
 */
function SyncAnnouncement({ status }: { status: SyncStatus | null }) {
  const { t } = useTranslation()
  // The result of the last run is news only after a run seen in this session.
  const [sawRun, setSawRun] = useState(false)
  const active = status !== null && status.state !== 'idle'
  if (active && !sawRun) setSawRun(true)

  let message = ''
  if (active) {
    if (status.state === 'cancelling') message = t('sync.cancelling')
    else if (status.phase === null) message = t('sync.starting')
    else message = t(`sync.phase.${status.phase}`)
  } else if (sawRun && status !== null && status.lastFinished !== null) {
    message = t('sync.ended', { status: t(`sync.status.${status.lastFinished.status}`) })
  }
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  )
}

function RunningSync({ status }: { status: SyncStatus }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <>
      <p className="flex flex-wrap justify-end gap-x-2 text-sm text-fg">
        <span className="font-medium">
          {status.phase === null ? t('sync.starting') : t(`sync.phase.${status.phase}`)}
        </span>
        {status.total > 0 && (
          <span className="text-fg-muted tabular-nums">
            {t('sync.progress', {
              done: format.number(status.done),
              total: format.number(status.total),
            })}
          </span>
        )}
      </p>
      <ProgressBar
        className="w-56"
        value={status.done}
        max={status.total}
        label={t('sync.progressLabel')}
      />
    </>
  )
}

function LastRun({ sync }: { sync: SyncControls }) {
  const { t } = useTranslation()
  const format = useFormat()
  if (sync.error !== null) {
    return (
      <p className="max-w-md text-xs text-fg-muted">
        {t('sync.unavailable', { reason: t(`errors.${sync.error}`) })}
      </p>
    )
  }
  if (sync.status === null) return <p className="text-sm text-fg-muted">{t('common.loading')}</p>
  const last = sync.status.lastFinished
  if (last === null) return <p className="text-sm text-fg-muted">{t('sync.never')}</p>

  const troubled = last.status === 'degraded' || last.status === 'failed'
  return (
    <>
      <p className="flex flex-wrap items-center justify-end gap-2 text-sm text-fg-muted">
        <span>{t('sync.last', { time: format.timestamp(last.finishedAt ?? last.startedAt) })}</span>
        <Badge size="sm" variant={RUN_VARIANT[last.status]}>
          {t(`sync.status.${last.status}`)}
        </Badge>
      </p>
      {troubled && last.note !== null && (
        <p
          className={cx(
            'flex max-w-md items-start gap-1.5 text-left text-xs',
            last.status === 'failed' ? 'text-danger-text' : 'text-warning-text',
          )}
        >
          <AlertIcon />
          <span>{last.note}</span>
        </p>
      )}
    </>
  )
}
