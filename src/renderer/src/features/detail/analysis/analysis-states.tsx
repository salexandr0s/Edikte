import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisRecord } from '@shared/analysis-schema'
import type { AppErrorCode } from '@shared/errors'
import { Button } from '../../../components/ui/button'
import { AlertIcon } from '../../../components/ui/icons'
import { ProgressBar } from '../../../components/ui/progress-bar'
import { Spinner } from '../../../components/ui/spinner'
import { useToast } from '../../../components/ui/toast'
import { errorCode, invoke } from '../../../lib/bridge'
import { cx } from '../../../lib/cx'
import { useFormat } from '../../../lib/format'
import { joinPresent, type AnalysisView } from '../detail-helpers'

interface StartProps {
  /** False when the listing has no Langgutachten to analyze. */
  canAnalyze: boolean
  /** The analysis gate is asking its questions. */
  requesting: boolean
  onAnalyze: () => void
}

export function NoAnalysis({ canAnalyze, requesting, onAnalyze }: StartProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-sm text-fg-muted">
        {canAnalyze ? t('analysis.intro') : t('analysis.noGutachten')}
      </p>
      {canAnalyze && (
        <Button loading={requesting} onClick={onAnalyze}>
          {t('analysis.start')}
        </Button>
      )}
    </div>
  )
}

type PendingView = Extract<AnalysisView, { kind: 'pending' }>

/** A queued or running analysis: current step, queue length and Cancel. */
export function PendingAnalysis({ view }: { view: PendingView }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [cancelling, setCancelling] = useState(false)
  const queued = view.status === 'queued'
  const step = queued
    ? null
    : view.step === null
      ? t('analysis.step.unknown')
      : t(`analysis.step.${view.step}`)

  async function cancel() {
    setCancelling(true)
    try {
      // The view changes once main reports the cancelled run.
      await invoke('analysis:cancel', { analysisId: view.analysisId })
    } catch (error) {
      setCancelling(false)
      toast({
        kind: 'error',
        title: t('analysis.cancelFailed'),
        description: t(`errors.${errorCode(error)}`),
      })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Spinner />
          {queued ? t('analysis.queuedTitle') : t('analysis.runningTitle')}
        </p>
        {step !== null && <p className="text-sm text-fg-muted">{step}</p>}
        {view.queued !== null && view.queued > 0 && (
          <p className="text-xs text-fg-muted">{t('analysis.inQueue', { count: view.queued })}</p>
        )}
      </div>
      <ProgressBar value={0} max={0} label={t('analysis.progressLabel')} />
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        loading={cancelling}
        onClick={() => void cancel()}
      >
        {t('analysis.cancel')}
      </Button>
    </div>
  )
}

/** A run has ended and the listing is loading again to bring its record. */
export function EndedAnalysis({
  error,
  onRetry,
}: {
  /** Why that reload failed, or null while it runs. */
  error: AppErrorCode | null
  onRetry: () => void
}) {
  const { t } = useTranslation()
  if (error === null) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
        <Spinner />
        {t('analysis.loadingResult')}
      </p>
    )
  }
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p className="flex items-start gap-2 text-sm font-medium text-danger-text">
        <AlertIcon className="mt-0.5" />
        {t('analysis.resultLoadFailed')}
      </p>
      <p className="text-sm">{t(`errors.${error}`)}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}

/** The latest run failed or was cancelled. */
export function StoppedAnalysis({
  record,
  canAnalyze,
  requesting,
  onAnalyze,
}: StartProps & { record: AnalysisRecord }) {
  const { t } = useTranslation()
  const format = useFormat()
  const failed = record.status === 'failed'
  const run = joinPresent(
    [
      t(`providerName.${record.provider}`),
      record.model,
      format.timestamp(record.finishedAt ?? record.createdAt),
    ],
    ' · ',
  )
  return (
    <div className="flex flex-col items-start gap-3">
      <p className={cx('flex items-start gap-2 text-sm font-medium', failed && 'text-danger-text')}>
        {failed && <AlertIcon className="mt-0.5" />}
        {failed ? t('analysis.failed') : t('analysis.cancelled')}
      </p>
      {failed && record.error !== null && (
        <p className="text-sm">{t(`errors.${record.error.code}`)}</p>
      )}
      <p className="text-xs text-fg-muted">{run}</p>
      {canAnalyze && (
        <Button loading={requesting} onClick={onAnalyze}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
