import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListingRow } from '@shared/domain'
import { useAnalysisGate } from '../../components/analysis-gate'
import { Button } from '../../components/ui/button'
import { SparklesIcon } from '../../components/ui/icons'
import { Spinner } from '../../components/ui/spinner'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import { analyzableIds, queueCounts, type AnalysisTracker } from './query-helpers'

interface AnalysisActionsProps {
  /** The shown rows, after the filters. */
  rows: ListingRow[]
  tracker: AnalysisTracker
}

/** "1 running, 3 waiting" with Cancel all, while any analysis is queued or running. */
export function AnalysisQueueStatus({ rows, tracker }: AnalysisActionsProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [cancelling, setCancelling] = useState(false)
  const { running, waiting } = queueCounts(rows, tracker)
  if (running + waiting === 0) return null

  async function cancelAll() {
    setCancelling(true)
    try {
      await invoke('analysis:cancel', { all: true })
      toast({ kind: 'info', title: t('batch.analysis.cancelled') })
    } catch (error) {
      toast({
        kind: 'error',
        title: t('batch.analysis.cancelFailed'),
        description: t(`errors.${errorCode(error)}`),
      })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="flex h-8 items-center gap-2 rounded-full bg-accent-soft py-0.5 pr-1 pl-3 text-sm text-accent-text">
      <Spinner className="size-3.5" />
      <span role="status" className="font-medium">
        {t('batch.analysis.queue', {
          running: t('batch.analysis.running', { count: running }),
          waiting: t('batch.analysis.waiting', { count: waiting }),
        })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 rounded-full px-2 text-xs text-accent-text hover:bg-accent-subtle"
        loading={cancelling}
        onClick={() => void cancelAll()}
      >
        {t('batch.analysis.cancelAll')}
      </Button>
    </div>
  )
}

/**
 * Analyzes the shown listings that have no finished, queued or running
 * analysis. The gate checks the provider, asks for consent and shows the estimate.
 */
export function AnalyzeFilteredButton({
  rows,
  tracker,
  disabled,
}: AnalysisActionsProps & { disabled: boolean }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { requestAnalysis } = useAnalysisGate()
  const [requesting, setRequesting] = useState(false)

  async function analyze() {
    if (disabled) return
    const ids = analyzableIds(rows, tracker)
    if (ids.length === 0) {
      toast({
        kind: 'info',
        title: t('batch.analysis.nothingTitle'),
        description: t('batch.analysis.nothingText'),
      })
      return
    }
    setRequesting(true)
    try {
      await requestAnalysis(ids)
    } finally {
      setRequesting(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      loading={requesting}
      disabled={disabled}
      onClick={() => void analyze()}
    >
      <SparklesIcon className="text-accent-text" />
      {t('batch.analysis.button')}
    </Button>
  )
}
