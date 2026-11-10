import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncRunSummary, SyncStatus } from '@shared/domain'
import type { EdictSource } from '@shared/enums'
import { Badge, type BadgeVariant } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { AlertIcon, RefreshIcon } from '../../components/ui/icons'
import { ProgressBar } from '../../components/ui/progress-bar'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { summarizeRuns } from './sync-summary'
import type { SyncControls } from './use-sync'

const RUN_VARIANT: Readonly<Record<SyncRunSummary['status'], BadgeVariant>> = {
  running: 'primary',
  ok: 'success',
  degraded: 'warning',
  failed: 'danger',
  cancelled: 'default',
}

interface SyncBarProps {
  sync: SyncControls
  /** The enabled sources. */
  sources: readonly EdictSource[]
}

/**
 * The running sync with its progress, or how the last run of each source
 * ended, and the matching action.
 */
export function SyncBar({ sync, sources }: SyncBarProps) {
  const { t } = useTranslation()
  const { status } = sync
  const active = status !== null && status.state !== 'idle'
  // With one source enabled, every text is about it and needs no name.
  const withSource = sources.length > 1

  return (
    <div className="flex min-w-0 items-center gap-4">
      <SyncAnnouncement status={status} withSource={withSource} />
      <div className="flex min-w-0 flex-col items-end gap-1.5 text-right">
        {active ? (
          <RunningSync status={status} withSource={withSource} />
        ) : (
          <LastRuns sync={sync} withSource={withSource} />
        )}
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
function SyncAnnouncement({
  status,
  withSource,
}: {
  status: SyncStatus | null
  withSource: boolean
}) {
  const { t } = useTranslation()
  // How the last sync ended is news only after a sync seen in this session.
  const [sawRun, setSawRun] = useState(false)
  const active = status !== null && status.state !== 'idle'
  if (active && !sawRun) setSawRun(true)

  let message = ''
  if (active) {
    if (status.state === 'cancelling') message = t('sync.cancelling')
    else message = runningText(status, withSource, t)
  } else if (sawRun && status !== null) {
    const summary = summarizeRuns(status.lastRuns)
    if (summary !== null) {
      message = t('sync.ended', { status: t(`sync.status.${summary.status}`) })
    }
  }
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  )
}

/**
 * The text for a sync in progress: its phase, led by the source being read
 * when several are enabled.
 */
function runningText(status: SyncStatus, withSource: boolean, t: TFunction): string {
  if (status.phase === null) return t('sync.starting')
  const phase = t(`sync.phase.${status.phase}`)
  if (!withSource || status.current === null) return phase
  return t('sync.phaseOf', { source: t(`edictSource.${status.current.source}`), phase })
}

function RunningSync({ status, withSource }: { status: SyncStatus; withSource: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <>
      <p className="flex flex-wrap justify-end gap-x-2 text-sm text-fg">
        <span className="font-medium">{runningText(status, withSource, t)}</span>
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

/** How the last run of each source ended, with a note for each one that went wrong. */
function LastRuns({ sync, withSource }: { sync: SyncControls; withSource: boolean }) {
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
  const summary = summarizeRuns(sync.status.lastRuns)
  if (summary === null) return <p className="text-sm text-fg-muted">{t('sync.never')}</p>

  return (
    <>
      <p className="flex flex-wrap items-center justify-end gap-2 text-sm text-fg-muted">
        <span>{t('sync.last', { time: format.timestamp(summary.finishedAt) })}</span>
        <Badge size="sm" variant={RUN_VARIANT[summary.status]}>
          {t(`sync.status.${summary.status}`)}
        </Badge>
      </p>
      {summary.troubled.map((run) => (
        <p
          key={run.id}
          className={cx(
            'flex max-w-md items-start gap-1.5 text-left text-xs',
            run.status === 'failed' ? 'text-danger-text' : 'text-warning-text',
          )}
        >
          <AlertIcon />
          <span>
            {withSource
              ? t('sync.noteOf', { source: t(`edictSource.${run.source}`), note: run.note })
              : run.note}
          </span>
        </p>
      ))}
    </>
  )
}
