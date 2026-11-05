import { ANALYSIS_SCHEMA_VERSION, type AnalysisRecord } from '@shared/analysis-schema'
import type { AnalysisEstimate, Settings } from '@shared/domain'
import { AppError, isAppError, type AppErrorCode } from '@shared/errors'
import { PROVIDER_IDS, type ProviderId } from '@shared/providers'
import { AnalysisQueue } from '../../ai/analysis/batch'
import { buildAnalysisEstimate } from '../../ai/analysis/estimate'
import { PROMPT_VERSION } from '../../ai/analysis/prompt'
import {
  analyzedEdicts,
  cancelPendingAnalyses,
  createAnalysisJobStore,
  findAnalysis,
  listAnalyses,
  pendingAnalysisEdicts,
  queueAnalyses,
} from '../../db/analysis-store'
import type { AppDatabase } from '../../db/client'
import type { EmitEvent } from '../../ipc/events'
import { log } from '../../log'
import {
  createJobRunner,
  modelTakesImages,
  type ActiveProvider,
  type JobRunnerDeps,
} from './analysis-job'

// "Analyze filtered" and the analysis history behind the analysis:* channels.
// Jobs are rows of the analyses table; AnalysisQueue runs one per provider at a time.

export interface AnalysisServiceDeps extends JobRunnerDeps {
  db: AppDatabase
  /** Current settings: consent, selected provider and saved models. */
  settings: () => Settings
  emit: EmitEvent
  now?: () => Date
}

export interface AnalysisService {
  estimate(request: { edictIds: string[] }): Promise<AnalysisEstimate>
  /** Checks consent, then the selected provider, then that it is ready; queues one job per listing. */
  start(request: { edictIds: string[] }): Promise<{ queued: number }>
  cancel(request: { analysisId: number } | { all: true }): Promise<void>
  /** Newest first. */
  list(request: { edictId: string }): AnalysisRecord[]
  /** Queues the jobs the last session left queued or running; returns how many. */
  resumeQueued(): Promise<number>
  /** For app quit: pending jobs stay in the table for the next start. */
  shutdown(): Promise<void>
  /** Settles once no job is queued or running. */
  idle(): Promise<void>
}

const PROVIDER_UNAVAILABLE: ReadonlySet<AppErrorCode> = new Set([
  'provider_not_selected',
  'provider_not_connected',
])

type EstimateTarget = Pick<AnalysisEstimate, 'provider' | 'model'> & { imagesSupported: boolean }

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  const { db, store, emit } = deps
  const now = deps.now ?? (() => new Date())
  const jobs = createAnalysisJobStore(db)
  const changed = (edictIds: readonly string[]): void => {
    if (edictIds.length > 0) emit('listings:changed', { edictIds: [...edictIds] })
  }
  const queue = new AnalysisQueue({
    store: jobs,
    run: createJobRunner(deps),
    onProgress: (progress) => emit('analysis:progress', progress),
    onStatusChange: changed,
    now: () => now().toISOString(),
  })

  /**
   * Cancels the jobs of these providers (every provider when null): first the
   * queue's, then the pending rows the queue does not own. Those are left from
   * a session whose jobs did not resume, such as an offline one.
   */
  const cancelPending = async (providers: readonly ProviderId[] | null): Promise<void> => {
    if (providers === null) await queue.cancel({ all: true })
    else for (const provider of providers) await queue.cancel({ provider })
    // Jobs the queue still owns are running; the queue stores how they end.
    changed(
      cancelPendingAnalyses(db, {
        keep: queue.ownedIds(),
        providers,
        finishedAt: now().toISOString(),
      }),
    )
  }

  // A job never moves to another provider, so a new selection cancels the jobs of the others.
  const unsubscribe = deps.providers.onSelectionChange((selected) => {
    void cancelPending(PROVIDER_IDS.filter((id) => id !== selected)).catch((error: unknown) => {
      log.error(
        'analysis',
        'Could not cancel the jobs of the previous provider',
        isAppError(error) ? error.code : undefined,
      )
    })
  })

  /** The active provider, or the selected one while it is not connected. */
  const estimateTarget = async (): Promise<EstimateTarget> => {
    let active: ActiveProvider
    try {
      active = await deps.providers.active()
    } catch (error) {
      if (!isAppError(error) || !PROVIDER_UNAVAILABLE.has(error.code)) throw error
      const { selectedProvider, models } = deps.settings()
      const model = selectedProvider === null ? null : (models[selectedProvider] ?? null)
      return { provider: selectedProvider, model, imagesSupported: false }
    }
    return {
      provider: active.provider.id,
      model: active.model,
      imagesSupported: await modelTakesImages(active.provider, active.model),
    }
  }

  return {
    async estimate({ edictIds }) {
      const ids = [...new Set(edictIds)]
      const gutachten = [...store.langgutachten(ids).values()]
      return buildAnalysisEstimate({
        ...(await estimateTarget()),
        listings: ids.length,
        alreadyAnalyzed: analyzedEdicts(db, ids, PROMPT_VERSION).size,
        withoutDocument: ids.length - gutachten.length,
        downloadKb: gutachten.reduce(
          (sum, document) =>
            document.localPath === null ? sum + (document.statedSizeKb ?? 0) : sum,
          0,
        ),
        // A Gutachten not read yet counts as a typical one.
        documents: gutachten.map((document) =>
          document.localPath !== null && document.extractedAt !== null
            ? store.pageTexts(document.id)
            : null,
        ),
      })
    },

    async start({ edictIds }) {
      const settings = deps.settings()
      if (settings.analysisConsentAt === null) {
        throw new AppError(
          'consent_required',
          'Sending report text to the AI provider is not accepted yet',
        )
      }
      if (settings.selectedProvider === null) {
        throw new AppError('provider_not_selected', 'No AI provider is selected')
      }
      const active = await deps.providers.active()
      if (active.status.state !== 'ready') {
        throw new AppError('provider_not_connected', `${active.provider.id} is not ready`)
      }
      // A switch while the provider was checked has already cancelled the jobs of this one.
      if (deps.settings().selectedProvider !== active.provider.id) {
        throw new AppError('provider_not_selected', `${active.provider.id} is no longer selected`)
      }
      const ids = [...new Set(edictIds)]
      const gutachten = store.langgutachten(ids)
      const pending = pendingAnalysisEdicts(db, ids)
      const queued = queueAnalyses(
        db,
        ids.flatMap((edictId) => {
          const document = gutachten.get(edictId)
          if (document === undefined || pending.has(edictId)) return []
          return [
            {
              edictId,
              provider: active.provider.id,
              model: active.model,
              accountLabel: active.status.accountLabel,
              promptVersion: PROMPT_VERSION,
              schemaVersion: ANALYSIS_SCHEMA_VERSION,
              documentIds: [document.id],
            },
          ]
        }),
        now().toISOString(),
      )
      if (queued.length > 0) {
        changed(queued.map((job) => job.edictId))
        queue.enqueue(queued)
      }
      return { queued: queued.length }
    },

    async cancel(target) {
      if ('all' in target) return cancelPending(null)
      // A job the queue owns ends through the queue, however often Cancel is pressed.
      if (queue.owns(target.analysisId)) {
        await queue.cancel(target)
        return
      }
      const row = findAnalysis(db, target.analysisId)
      if (row === null) throw new AppError('not_found', `No analysis ${target.analysisId}`)
      // Left pending by a previous session, before resumeQueued picked it up.
      if (row.status === 'queued' || row.status === 'running') {
        await jobs.markCancelled(row.id, now().toISOString())
        emit('analysis:progress', {
          analysisId: row.id,
          edictId: row.edictId,
          status: 'cancelled',
          step: null,
          queued: 0,
        })
        changed([row.edictId])
      }
    },

    list: ({ edictId }) => listAnalyses(db, edictId),
    resumeQueued: () => queue.restore(),
    shutdown: () => {
      unsubscribe()
      return queue.shutdown()
    },
    idle: () => queue.idle(),
  }
}
