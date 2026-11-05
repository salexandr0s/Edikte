import { ANALYSIS_SCHEMA_VERSION, type AnalysisRecord } from '@shared/analysis-schema'
import type { AnalysisEstimate, AnalysisProgress, Settings } from '@shared/domain'
import { AppError, isAppError, type AppErrorCode } from '@shared/errors'
import { AnalysisQueue } from '../../ai/analysis/batch'
import { buildAnalysisEstimate } from '../../ai/analysis/estimate'
import { PROMPT_VERSION } from '../../ai/analysis/prompt'
import {
  analyzedEdicts,
  createAnalysisJobStore,
  findAnalysis,
  listAnalyses,
  pendingAnalysisEdicts,
  queueAnalyses,
} from '../../db/analysis-store'
import type { AppDatabase } from '../../db/client'
import type { EmitEvent } from '../../ipc/events'
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
  const report = (progress: AnalysisProgress): void => {
    emit('analysis:progress', progress)
    // Step null marks a job that started or ended: the listing's status changed.
    if (progress.status !== 'queued' && progress.step === null) {
      emit('listings:changed', { edictIds: [progress.edictId] })
    }
  }
  const queue = new AnalysisQueue({
    store: jobs,
    run: createJobRunner(deps),
    onProgress: report,
    now: () => now().toISOString(),
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
        emit('listings:changed', { edictIds: queued.map((job) => job.edictId) })
        queue.enqueue(queued)
      }
      return { queued: queued.length }
    },

    async cancel(target) {
      if ((await queue.cancel(target)) > 0 || 'all' in target) return
      const row = findAnalysis(db, target.analysisId)
      if (row === null) throw new AppError('not_found', `No analysis ${target.analysisId}`)
      // Left pending by a previous session, before resumeQueued picked it up.
      if (row.status === 'queued' || row.status === 'running') {
        await jobs.markCancelled(row.id, now().toISOString())
        report({
          analysisId: row.id,
          edictId: row.edictId,
          status: 'cancelled',
          step: null,
          queued: 0,
        })
      }
    },

    list: ({ edictId }) => listAnalyses(db, edictId),
    resumeQueued: () => queue.restore(),
    shutdown: () => queue.shutdown(),
    idle: () => queue.idle(),
  }
}
