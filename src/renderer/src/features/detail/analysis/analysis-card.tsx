import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisProgress, ListingDetail } from '@shared/domain'
import { useAnalysisGate } from '../../../components/analysis-gate'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { RefreshIcon } from '../../../components/ui/icons'
import { useBridgeEvent } from '../../../lib/use-bridge-event'
import { analysisView, isPending, type AnalysisView } from '../detail-helpers'
import { AnalysisHistory, OlderRunNotice, useAnalysisHistory } from './analysis-history'
import { AnalysisResult } from './analysis-result'
import { NoAnalysis, PendingAnalysis, StoppedAnalysis } from './analysis-states'

interface AnalysisCardProps {
  detail: ListingDetail
  /** Loads the listing again, e.g. when a run has ended. */
  reload: () => void
}

/**
 * The latest analysis with live progress, earlier runs, and the way to start
 * one. Every start goes through the analysis gate, never analysis:start.
 */
export function AnalysisCard({ detail, reload }: AnalysisCardProps) {
  const { t } = useTranslation()
  const { requestAnalysis } = useAnalysisGate()
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [viewedRunId, setViewedRunId] = useState<number | null>(null)

  useBridgeEvent('analysis:progress', (event) => {
    if (event.edictId !== detail.id) return
    setProgress(event)
    if (!isPending(event.status)) reload()
  })

  const record = detail.analysis
  const view = analysisView(record, progress)
  // While a new run is pending, the previous one stays reachable in the history.
  const latestId = view.kind === 'pending' ? view.analysisId : (record?.id ?? null)
  const history = useAnalysisHistory(
    detail.id,
    record === null ? 'none' : `${record.id}:${record.status}`,
  )
  const viewedRun =
    history.runs?.find((run) => run.id === viewedRunId && run.status === 'done') ?? null
  const documentId = detail.documents.find((doc) => doc.kind === 'langgutachten')?.id ?? null
  const canAnalyze = detail.hasLanggutachten

  async function analyze() {
    setViewedRunId(null)
    setRequesting(true)
    try {
      await requestAnalysis([detail.id])
    } finally {
      setRequesting(false)
    }
  }
  const start = () => void analyze()

  return (
    <Card
      title={t('analysis.title')}
      actions={
        view.kind === 'done' && canAnalyze ? (
          <Button variant="outline" size="sm" loading={requesting} onClick={start}>
            <RefreshIcon />
            {t('analysis.again')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        {viewedRun === null ? (
          <CurrentAnalysis
            view={view}
            documentId={documentId}
            canAnalyze={canAnalyze}
            requesting={requesting}
            onAnalyze={start}
          />
        ) : (
          <>
            <OlderRunNotice run={viewedRun} onShowLatest={() => setViewedRunId(null)} />
            <AnalysisResult record={viewedRun} documentId={documentId} />
          </>
        )}
        <AnalysisHistory
          history={history}
          latestId={latestId}
          viewedRunId={viewedRun?.id ?? null}
          onView={setViewedRunId}
        />
      </div>
    </Card>
  )
}

interface CurrentAnalysisProps {
  view: AnalysisView
  documentId: number | null
  canAnalyze: boolean
  requesting: boolean
  onAnalyze: () => void
}

function CurrentAnalysis({ view, documentId, ...start }: CurrentAnalysisProps) {
  switch (view.kind) {
    case 'none':
      return <NoAnalysis {...start} />
    case 'pending':
      // A new run starts with a fresh Cancel button.
      return <PendingAnalysis key={view.analysisId} view={view} />
    case 'stopped':
      return <StoppedAnalysis record={view.record} {...start} />
    case 'done':
      return <AnalysisResult record={view.record} documentId={documentId} />
  }
}
