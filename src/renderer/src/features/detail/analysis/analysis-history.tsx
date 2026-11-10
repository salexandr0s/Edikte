import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisRecord } from '@shared/analysis-schema'
import type { AnalysisStatus } from '@shared/enums'
import type { AppErrorCode } from '@shared/errors'
import { Badge, type BadgeVariant } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { errorCode, invoke } from '../../../lib/bridge'
import { useFormat } from '../../../lib/format'

const STATUS_VARIANTS: Readonly<Record<AnalysisStatus, BadgeVariant>> = {
  queued: 'default',
  running: 'primary',
  done: 'success',
  failed: 'danger',
  cancelled: 'default',
}

export interface AnalysisHistoryState {
  /** Every run of the listing, newest first; null until loaded. */
  runs: AnalysisRecord[] | null
  failed: AppErrorCode | null
}

/** Loads analysis:list, and loads it again whenever `latestKey` changes. */
export function useAnalysisHistory(edictId: string, latestKey: string): AnalysisHistoryState {
  const key = `${edictId}:${latestKey}`
  const [history, setHistory] = useState<AnalysisHistoryState & { key: string }>({
    runs: null,
    failed: null,
    key,
  })
  useEffect(() => {
    let current = true
    invoke('analysis:list', { edictId }).then(
      (runs) => {
        if (current) setHistory({ runs, failed: null, key })
      },
      (error: unknown) => {
        if (current)
          setHistory((previous) => ({
            runs: previous.key === key ? previous.runs : null,
            failed: errorCode(error),
            key,
          }))
      },
    )
    return () => {
      current = false
    }
  }, [edictId, key])
  return history.key === key ? history : { runs: null, failed: null }
}

const runDate = (run: AnalysisRecord) => run.finishedAt ?? run.createdAt

interface AnalysisHistoryProps {
  history: AnalysisHistoryState
  /** The latest run, shown above the list and left out of it. */
  latestId: number | null
  viewedRunId: number | null
  onView: (runId: number) => void
}

/** Earlier runs as a compact list; finished ones can be shown again. */
export function AnalysisHistory({ history, latestId, viewedRunId, onView }: AnalysisHistoryProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const headingId = useId()
  const earlier = (history.runs ?? []).filter((run) => run.id !== latestId)

  if (history.runs === null && history.failed !== null) {
    return <p className="text-xs text-fg-muted">{t('analysis.history.failed')}</p>
  }
  if (earlier.length === 0) return null

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 border-t border-border pt-6"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {t('analysis.history.title')}
      </h3>
      <ul className="flex flex-col divide-y divide-border">
        {earlier.map((run) => {
          const date = format.timestamp(runDate(run))
          return (
            <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="tabular-nums">{date}</span>
              <span className="text-fg-muted">
                {t(`providerName.${run.provider}`)} · {run.model}
              </span>
              <Badge
                size="sm"
                variant={run.stale ? 'warning' : STATUS_VARIANTS[run.status]}
                title={run.stale ? t('analysis.stale.reason') : undefined}
              >
                {run.stale ? t('analysis.stale.label') : t(`analysisStatus.${run.status}`)}
              </Badge>
              {run.status === 'done' && run.id !== viewedRunId && (
                <Button
                  variant="link"
                  className="ml-auto"
                  aria-label={t('analysis.history.showRun', { date })}
                  onClick={() => onView(run.id)}
                >
                  {t('analysis.history.show')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Shown above an earlier run, with the way back to the latest one. */
export function OlderRunNotice({
  run,
  onShowLatest,
}: {
  run: AnalysisRecord
  onShowLatest: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-subtle bg-accent-soft px-4 py-3">
      <p className="text-sm">
        {t('analysis.history.viewing', { date: format.timestamp(runDate(run)) })}
      </p>
      <Button size="sm" variant="outline" onClick={onShowLatest}>
        {t('analysis.history.showLatest')}
      </Button>
    </div>
  )
}
