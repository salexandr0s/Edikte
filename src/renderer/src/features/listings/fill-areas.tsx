import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentProgress, FillPlan, ListingQuery } from '@shared/domain'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { ProgressBar } from '../../components/ui/progress-bar'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import { useFormat } from '../../lib/format'
import { useBridgeEvent } from '../../lib/use-bridge-event'

type FillPhase = Extract<DocumentProgress['phase'], 'download' | 'extract' | 'estimate'>

interface FillProgress {
  phase: FillPhase
  done: number
  total: number
  bytesDone: number | null
  bytesTotal: number | null
}

export interface FillJob {
  progress: FillProgress | null
  checking: boolean
  cancelling: boolean
  /** Set while the confirmation dialog is open. */
  plan: FillPlan | null
  check: () => void
  confirm: () => void
  dismiss: () => void
  cancel: () => void
}

/** "Fill missing areas": plan, confirmation, then progress from documents:progress. */
export function useFillJob(query: ListingQuery): FillJob {
  const { t } = useTranslation()
  const format = useFormat()
  const toast = useToast()
  const [checking, setChecking] = useState(false)
  const [pending, setPending] = useState<{ plan: FillPlan; query: ListingQuery } | null>(null)
  const [progress, setProgress] = useState<FillProgress | null>(null)
  const [cancelling, setCancelling] = useState(false)
  // True from the start of a fill until its last event. Events can arrive
  // before documents:fill answers.
  const running = useRef(false)

  const fail = (title: string, error: unknown) =>
    toast({ kind: 'error', title, description: t(`errors.${errorCode(error)}`) })

  async function check() {
    setChecking(true)
    try {
      const plan = await invoke('documents:planFill', query)
      if (plan.documents > 0) {
        setPending({ plan, query })
      } else {
        toast({
          kind: 'info',
          title: t('batch.fill.nothingTitle'),
          description:
            plan.listings === 0
              ? t('batch.fill.allHaveArea')
              : t('batch.fill.noDocuments', { count: plan.listings }),
        })
      }
    } catch (error) {
      fail(t('batch.fill.checkFailed'), error)
    } finally {
      setChecking(false)
    }
  }

  async function confirm() {
    if (pending === null) return
    setPending(null)
    running.current = true
    const total = pending.plan.documents
    setProgress({ phase: 'download', done: 0, total, bytesDone: null, bytesTotal: null })
    try {
      const plan = await invoke('documents:fill', pending.query)
      if (!running.current) return
      if (plan.documents === 0) {
        // Nothing left to download, and no event will follow.
        running.current = false
        setProgress(null)
      } else {
        setProgress((current) => current && { ...current, total: plan.documents })
      }
    } catch (error) {
      running.current = false
      setProgress(null)
      fail(t('batch.fill.startFailed'), error)
    }
  }

  async function cancel() {
    setCancelling(true)
    try {
      await invoke('documents:cancelFill')
    } catch (error) {
      setCancelling(false)
      fail(t('batch.fill.cancelFailed'), error)
    }
  }

  useBridgeEvent('documents:progress', (event) => {
    if (event.job !== 'fill') return
    if (event.phase === 'download' || event.phase === 'extract' || event.phase === 'estimate') {
      running.current = true
      const { phase, done, total, bytesDone, bytesTotal } = event
      setProgress({ phase, done, total, bytesDone, bytesTotal })
      return
    }
    // Only the last event of a fill has no document ID. The others end one
    // document (main sends "failed" per document), not the fill.
    if (event.documentId !== null) return
    if (!running.current) return
    running.current = false
    setProgress(null)
    setCancelling(false)
    const description = t('batch.fill.summary', {
      done: format.number(event.done),
      total: format.number(event.total),
    })
    if (event.phase === 'done') {
      toast({ kind: 'success', title: t('batch.fill.finished'), description })
    } else if (event.phase === 'cancelled') {
      toast({ kind: 'info', title: t('batch.fill.cancelled'), description })
    } else {
      toast({ kind: 'error', title: t('batch.fill.failed'), description })
    }
  })

  return {
    progress,
    checking,
    cancelling,
    plan: pending?.plan ?? null,
    check: () => void check(),
    confirm: () => void confirm(),
    dismiss: () => setPending(null),
    cancel: () => void cancel(),
  }
}

export function FillAreasButton({ job }: { job: FillJob }) {
  const { t } = useTranslation()
  const format = useFormat()
  const { plan } = job
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        loading={job.checking}
        disabled={job.progress !== null}
        onClick={job.check}
      >
        {t('batch.fill.button')}
      </Button>
      {plan !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) job.dismiss()
          }}
          title={t('batch.fill.confirmTitle', { documents: format.number(plan.documents) })}
          footer={
            <>
              <Button variant="outline" onClick={job.dismiss}>
                {t('common.cancel')}
              </Button>
              <Button onClick={job.confirm}>{t('batch.fill.start')}</Button>
            </>
          }
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
            <dt className="text-fg-muted">{t('batch.fill.listings')}</dt>
            <dd className="tabular-nums">{format.number(plan.listings)}</dd>
            <dt className="text-fg-muted">{t('batch.fill.documents')}</dt>
            <dd className="tabular-nums">{format.number(plan.documents)}</dd>
            <dt className="text-fg-muted">{t('batch.fill.size')}</dt>
            <dd className="tabular-nums">{format.fileSize(plan.totalKb)}</dd>
          </dl>
          <p className="mt-4 text-fg-muted">{t('batch.fill.confirmText')}</p>
        </Dialog>
      )}
    </>
  )
}

export function FillProgressPanel({ job }: { job: FillJob }) {
  const { t } = useTranslation()
  const format = useFormat()
  const { progress } = job
  const counts =
    progress === null || progress.total === 0
      ? null
      : {
          current: format.number(Math.min(progress.done + 1, progress.total)),
          total: format.number(progress.total),
        }
  // Screen readers hear the start and each new Gutachten, not every phase or
  // byte count. The end arrives as a toast.
  const announcement =
    progress === null
      ? ''
      : counts === null
        ? t('batch.fill.running')
        : t('batch.fill.announce', counts)
  const bytes =
    progress?.phase === 'download' && progress.bytesDone !== null && progress.bytesTotal !== null
      ? t('batch.fill.bytes', {
          done: format.fileSize(progress.bytesDone / 1024),
          total: format.fileSize(progress.bytesTotal / 1024),
        })
      : null

  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {progress !== null && (
        <section
          aria-label={t('batch.fill.running')}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{t('batch.fill.running')}</span>
            {counts !== null && (
              <span className="text-fg-muted tabular-nums">{t('batch.fill.item', counts)}</span>
            )}
            <span className="text-fg-muted">{t(`batch.fill.phase.${progress.phase}`)}</span>
            {bytes !== null && <span className="text-fg-muted tabular-nums">{bytes}</span>}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              loading={job.cancelling}
              onClick={job.cancel}
            >
              {t('common.cancel')}
            </Button>
          </div>
          <ProgressBar
            value={progress.done}
            max={progress.total}
            label={t('batch.fill.progressLabel')}
          />
        </section>
      )}
    </>
  )
}
