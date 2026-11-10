import type { AnalysisProgress } from '@shared/domain'
import { AppError, isAppError } from '@shared/errors'
import type { ProviderId } from '@shared/providers'
import { log } from '../../log'
import { analysisFailure, type AnalysisFailure, type AnalysisOutcome } from './pipeline'

/** One job of "Analyze filtered": an analyses row the caller created in status queued. */
export interface AnalysisJob {
  analysisId: number
  edictId: string
  /** Fixed when the job is queued: a job never moves to another provider or model. */
  provider: ProviderId
  model: string
}

/** A finished analysis with the documents the job actually read. */
export interface AnalysisJobOutcome extends AnalysisOutcome {
  documentIds: number[]
  /** Bytes of the first report when its pages were read. */
  documentSha256: string | null
}

/**
 * The queue's rows in the analyses table, implemented by the caller. Rows in
 * status queued or running are pending: after a restart `listPending` returns
 * them in the order they were queued, and `AnalysisQueue.restore` runs them again.
 */
export interface AnalysisJobStore {
  listPending(): AnalysisJob[] | Promise<AnalysisJob[]>
  markRunning(analysisId: number, startedAt: string): void | Promise<void>
  markDone(
    analysisId: number,
    outcome: AnalysisJobOutcome,
    finishedAt: string,
  ): void | Promise<void>
  markFailed(analysisId: number, failure: AnalysisFailure, finishedAt: string): void | Promise<void>
  markCancelled(analysisId: number, finishedAt: string): void | Promise<void>
}

export type AnalysisJobStep = NonNullable<AnalysisProgress['step']>

/**
 * Runs one job: downloads and reads the Gutachten when needed, then calls
 * runAnalysis. Reports its steps and fails with `cancelled` once the signal aborts.
 */
export type AnalysisJobRunner = (
  job: AnalysisJob,
  signal: AbortSignal,
  onStep: (step: AnalysisJobStep) => void,
) => Promise<AnalysisJobOutcome>

export type AnalysisCancelTarget = { analysisId: number } | { provider: ProviderId } | { all: true }

export interface AnalysisQueueOptions {
  store: AnalysisJobStore
  run: AnalysisJobRunner
  onProgress?: (progress: AnalysisProgress) => void
  /** Edicts whose job started or ended. A cancel reports all of its jobs in one call. */
  onStatusChange?: (edictIds: string[]) => void
  /** ISO UTC time for startedAt and finishedAt. */
  now?: () => string
  /** Wait before a result that could not be stored is written again. */
  storeRetryMs?: number
}

type FinalStatus = Extract<AnalysisProgress['status'], 'done' | 'failed' | 'cancelled'>

/** Writes of a finished result before the job is stored as failed instead. */
const RESULT_WRITE_ATTEMPTS = 2

interface RunningJob {
  job: AnalysisJob
  controller: AbortController
  /** Cancelled by the user, as opposed to aborted by shutdown. */
  cancelled: boolean
}

interface Lane {
  waiting: AnalysisJob[]
  running: RunningJob | null
  /** Settles when the lane has run out of jobs. */
  draining: Promise<void> | null
}

/**
 * The queue behind "Analyze filtered". Each provider runs one job at a time in
 * the order queued; different providers run side by side. Cancelling marks a
 * queued job cancelled at once and aborts a running one. The jobs are rows in
 * the analyses table, so after a restart `restore` picks up where the queue stopped.
 */
export class AnalysisQueue {
  private readonly lanes = new Map<ProviderId, Lane>()
  private readonly store: AnalysisJobStore
  private readonly run: AnalysisJobRunner
  private readonly onProgress: (progress: AnalysisProgress) => void
  private readonly onStatusChange: (edictIds: string[]) => void
  private readonly now: () => string
  private readonly storeRetryMs: number
  private stopped = false

  constructor(options: AnalysisQueueOptions) {
    this.store = options.store
    this.run = options.run
    this.onProgress = options.onProgress ?? (() => undefined)
    this.onStatusChange = options.onStatusChange ?? (() => undefined)
    this.now = options.now ?? (() => new Date().toISOString())
    this.storeRetryMs = options.storeRetryMs ?? 1000
  }

  /** Queues the jobs the last session left pending. Returns how many were queued. */
  async restore(): Promise<number> {
    return this.enqueue(await this.store.listPending())
  }

  /** Queues jobs behind those of the same provider, skipping jobs already queued or running. */
  enqueue(jobs: readonly AnalysisJob[]): number {
    if (this.stopped) return 0
    const added: AnalysisJob[] = []
    for (const job of jobs) {
      if (this.owns(job.analysisId)) continue
      this.lane(job.provider).waiting.push(job)
      added.push(job)
    }
    for (const job of added) this.emit(job, 'queued', 'waiting')
    for (const lane of this.lanes.values()) this.startLane(lane)
    return added.length
  }

  /**
   * Cancels matching jobs and returns how many there were. A running job ends
   * once its run stops; until then the queue still owns it.
   */
  async cancel(target: AnalysisCancelTarget): Promise<number> {
    const removed: AnalysisJob[] = []
    let running = 0
    for (const lane of this.lanes.values()) {
      removed.push(...lane.waiting.filter((job) => matches(job, target)))
      lane.waiting = lane.waiting.filter((job) => !matches(job, target))
      const current = lane.running
      if (current !== null && !current.cancelled && matches(current.job, target)) {
        current.cancelled = true
        current.controller.abort()
        running += 1
      }
    }
    for (const job of removed) {
      await this.write(job, () => this.store.markCancelled(job.analysisId, this.now()))
      this.emit(job, 'cancelled', null)
    }
    this.statusChanged(removed)
    return removed.length + running
  }

  /** Whether the job is queued or running here. Pending rows the queue does not own are left over. */
  owns(analysisId: number): boolean {
    for (const lane of this.lanes.values()) {
      if (lane.running?.job.analysisId === analysisId) return true
      if (lane.waiting.some((job) => job.analysisId === analysisId)) return true
    }
    return false
  }

  /** IDs of the jobs queued or running here. */
  ownedIds(): number[] {
    return [...this.lanes.values()].flatMap((lane) => [
      ...(lane.running === null ? [] : [lane.running.job.analysisId]),
      ...lane.waiting.map((job) => job.analysisId),
    ])
  }

  /** Jobs queued or running, for one provider or for all. */
  pendingCount(provider?: ProviderId): number {
    let count = 0
    for (const [id, lane] of this.lanes) {
      if (provider === undefined || provider === id) {
        count += lane.waiting.length + (lane.running === null ? 0 : 1)
      }
    }
    return count
  }

  /** Settles once no job is queued or running. */
  async idle(): Promise<void> {
    for (;;) {
      const draining = [...this.lanes.values()].flatMap((lane) => lane.draining ?? [])
      if (draining.length === 0) return
      await Promise.all(draining)
    }
  }

  /**
   * Stops for app quit. Queued jobs stay queued and running ones are aborted
   * without a status change, so `restore` runs them again on the next start.
   */
  async shutdown(): Promise<void> {
    this.stopped = true
    for (const lane of this.lanes.values()) {
      lane.waiting = []
      lane.running?.controller.abort()
    }
    await this.idle()
  }

  private startLane(lane: Lane): void {
    if (this.stopped || lane.draining !== null || lane.waiting.length === 0) return
    lane.draining = this.drain(lane).finally(() => {
      lane.draining = null
      // Jobs queued after the loop below took its last job.
      this.startLane(lane)
    })
  }

  private async drain(lane: Lane): Promise<void> {
    for (let job = lane.waiting.shift(); job !== undefined; job = lane.waiting.shift()) {
      const current: RunningJob = { job, controller: new AbortController(), cancelled: false }
      lane.running = current
      const status = await this.execute(current)
      lane.running = null
      if (status !== null) {
        this.emit(job, status, null)
        this.statusChanged([job])
      }
      if (this.stopped) return
    }
  }

  /** Runs a job and stores how it ended. Null when shutdown aborted it: the row stays pending. */
  private async execute(current: RunningJob): Promise<FinalStatus | null> {
    const { job } = current
    const { signal } = current.controller
    let outcome: AnalysisJobOutcome
    try {
      await this.store.markRunning(job.analysisId, this.now())
      if (signal.aborted) throw new AppError('cancelled', 'Analysis cancelled')
      this.emit(job, 'running', null)
      this.statusChanged([job])
      outcome = await this.run(job, signal, (step) => {
        if (!signal.aborted) this.emit(job, 'running', step)
      })
    } catch (error) {
      if (signal.aborted && !current.cancelled) return null
      if (current.cancelled || (isAppError(error) && error.code === 'cancelled')) {
        await this.write(job, () => this.store.markCancelled(job.analysisId, this.now()))
        return 'cancelled'
      }
      const failure = analysisFailure(error)
      await this.write(job, () => this.store.markFailed(job.analysisId, failure, this.now()))
      return 'failed'
    }
    // A run that completes despite a late cancel keeps its result: it has been paid for.
    return this.storeOutcome(job, outcome)
  }

  /**
   * Stores a finished run, trying again once. A result that cannot be stored
   * ends the job as failed with what the run spent and received, so a restart
   * does not pay for the same analysis twice.
   */
  private async storeOutcome(job: AnalysisJob, outcome: AnalysisJobOutcome): Promise<FinalStatus> {
    for (let attempt = 1; attempt <= RESULT_WRITE_ATTEMPTS; attempt += 1) {
      if (attempt > 1) await delay(this.storeRetryMs)
      try {
        await this.store.markDone(job.analysisId, outcome, this.now())
        return 'done'
      } catch (error) {
        log.error(
          'analysis-queue',
          `Could not store the result of analysis ${job.analysisId}`,
          errorName(error),
        )
      }
    }
    const failure: AnalysisFailure = {
      error: { code: 'storage_unavailable', message: 'The analysis result could not be saved' },
      rawResponse: outcome.rawResponse,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      costUsd: outcome.costUsd,
    }
    await this.write(job, () => this.store.markFailed(job.analysisId, failure, this.now()))
    return 'failed'
  }

  private emit(
    job: AnalysisJob,
    status: AnalysisProgress['status'],
    step: AnalysisProgress['step'],
  ): void {
    const waiting = this.lanes.get(job.provider)?.waiting ?? []
    const index = waiting.indexOf(job)
    try {
      this.onProgress({
        analysisId: job.analysisId,
        edictId: job.edictId,
        status,
        step,
        queued: index === -1 ? waiting.length : waiting.length - index - 1,
      })
    } catch (error) {
      log.error('analysis-queue', 'Progress listener failed', errorName(error))
    }
  }

  private statusChanged(jobs: readonly AnalysisJob[]): void {
    if (jobs.length === 0) return
    try {
      this.onStatusChange([...new Set(jobs.map((job) => job.edictId))])
    } catch (error) {
      log.error('analysis-queue', 'Status listener failed', errorName(error))
    }
  }

  // The run is over either way; one failed write must not stop the queue.
  private async write(job: AnalysisJob, action: () => void | Promise<void>): Promise<void> {
    try {
      await action()
    } catch (error) {
      log.error(
        'analysis-queue',
        `Could not store the status of analysis ${job.analysisId}`,
        errorName(error),
      )
    }
  }

  private lane(provider: ProviderId): Lane {
    let lane = this.lanes.get(provider)
    if (lane === undefined) {
      lane = { waiting: [], running: null, draining: null }
      this.lanes.set(provider, lane)
    }
    return lane
  }
}

function matches(job: AnalysisJob, target: AnalysisCancelTarget): boolean {
  if ('all' in target) return true
  if ('provider' in target) return job.provider === target.provider
  return job.analysisId === target.analysisId
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Error codes and names only: messages may quote stored data.
function errorName(error: unknown): string | undefined {
  if (isAppError(error)) return error.code
  return error instanceof Error ? error.name : undefined
}
