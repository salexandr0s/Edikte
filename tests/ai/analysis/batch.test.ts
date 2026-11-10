import { describe, expect, it, vi } from 'vitest'
import type { AnalysisProgress } from '@shared/domain'
import { AppError } from '@shared/errors'
import type { ProviderId } from '@shared/providers'
import {
  AnalysisQueue,
  type AnalysisJob,
  type AnalysisJobOutcome,
  type AnalysisJobRunner,
  type AnalysisJobStore,
} from '../../../src/main/ai/analysis/batch'
import { AnalysisRunError, type AnalysisFailure } from '../../../src/main/ai/analysis/pipeline'
import { houseAnswer } from './helpers'

interface Row {
  status: AnalysisProgress['status']
  failure?: AnalysisFailure
}

interface ControlledRun {
  job: AnalysisJob
  signal: AbortSignal
  finish(): void
  fail(error: Error): void
}

function job(analysisId: number, provider: ProviderId = 'chatgpt'): AnalysisJob {
  return {
    analysisId,
    edictId: analysisId.toString(16).padStart(32, '0'),
    provider,
    model: 'test-model',
  }
}

function outcome(current: AnalysisJob): AnalysisJobOutcome {
  return {
    provider: current.provider,
    model: current.model,
    requestedModel: current.model,
    accountLabel: null,
    promptVersion: 1,
    schemaVersion: 1,
    documentIds: [1],
    documentSha256: 'sha',
    result: houseAnswer,
    evidence: [],
    crossChecks: [],
    droppedPages: [],
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    rawResponse: '{}',
    attempts: 1,
  }
}

/** The analyses table in memory: rows of the pending jobs start as queued. */
function memoryStore(pending: readonly AnalysisJob[] = []) {
  const rows = new Map<number, Row>(pending.map((item) => [item.analysisId, { status: 'queued' }]))
  const store: AnalysisJobStore = {
    listPending: () =>
      pending.filter((item) =>
        ['queued', 'running'].includes(rows.get(item.analysisId)?.status ?? ''),
      ),
    markRunning: (analysisId) => {
      rows.set(analysisId, { status: 'running' })
    },
    markDone: (analysisId) => {
      rows.set(analysisId, { status: 'done' })
    },
    markFailed: (analysisId, failure) => {
      rows.set(analysisId, { status: 'failed', failure })
    },
    markCancelled: (analysisId) => {
      rows.set(analysisId, { status: 'cancelled' })
    },
  }
  return { store, rows, status: (analysisId: number) => rows.get(analysisId)?.status }
}

/** A runner whose jobs finish when the test says so, and reject once aborted. */
function controlledRunner() {
  const runs: ControlledRun[] = []
  const run: AnalysisJobRunner = (current, signal, onStep) =>
    new Promise<AnalysisJobOutcome>((resolve, reject) => {
      onStep('asking')
      signal.addEventListener(
        'abort',
        () => reject(new AppError('cancelled', 'Analysis cancelled')),
        { once: true },
      )
      runs.push({ job: current, signal, finish: () => resolve(outcome(current)), fail: reject })
    })
  return { run, runs, started: () => runs.map((item) => item.job.analysisId) }
}

const instantRunner: AnalysisJobRunner = (current) => Promise.resolve(outcome(current))

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('AnalysisQueue', () => {
  it('runs one job at a time per provider and providers side by side', async () => {
    const { store, status } = memoryStore()
    const runner = controlledRunner()
    const queue = new AnalysisQueue({ store, run: runner.run })
    expect(queue.enqueue([job(1), job(2), job(3, 'claude-cli'), job(1)])).toBe(3)
    await flush()
    expect(runner.started()).toEqual([1, 3])
    expect(queue.pendingCount('chatgpt')).toBe(2)

    runner.runs[0]?.finish()
    await flush()
    expect(runner.started()).toEqual([1, 3, 2])
    expect(status(1)).toBe('done')

    for (const run of runner.runs) run.finish()
    await queue.idle()
    expect([status(2), status(3), queue.pendingCount()]).toEqual(['done', 'done', 0])
  })

  it('reports each step with the number of jobs behind', async () => {
    const progress: Array<[number, string, string | null, number]> = []
    const runner = controlledRunner()
    const queue = new AnalysisQueue({
      store: memoryStore().store,
      run: runner.run,
      onProgress: (event) =>
        progress.push([event.analysisId, event.status, event.step, event.queued]),
    })
    queue.enqueue([job(1), job(2)])
    await flush()
    runner.runs[0]?.finish()
    await flush()
    expect(progress).toEqual([
      [1, 'queued', 'waiting', 1],
      [2, 'queued', 'waiting', 0],
      [1, 'running', null, 1],
      [1, 'running', 'asking', 1],
      [1, 'done', null, 1],
      [2, 'running', null, 0],
      [2, 'running', 'asking', 0],
    ])
  })

  it('cancels queued jobs at once and aborts the running one', async () => {
    const { store, status } = memoryStore()
    const runner = controlledRunner()
    const queue = new AnalysisQueue({ store, run: runner.run })
    queue.enqueue([job(1), job(2), job(3)])
    await flush()

    expect(await queue.cancel({ analysisId: 2 })).toBe(1)
    expect(status(2)).toBe('cancelled')
    expect(await queue.cancel({ provider: 'chatgpt' })).toBe(2)
    await queue.idle()
    expect([status(1), status(3)]).toEqual(['cancelled', 'cancelled'])
    expect(runner.started()).toEqual([1])
    expect(runner.runs[0]?.signal.aborted).toBe(true)
  })

  it('stores a failure with its error code and the raw answer', async () => {
    const { store, rows } = memoryStore()
    const runner = controlledRunner()
    const queue = new AnalysisQueue({ store, run: runner.run })
    queue.enqueue([job(1)])
    await flush()
    runner.runs[0]?.fail(
      new AnalysisRunError(
        'provider_invalid_output',
        'Invalid answer',
        'raw text',
        { inputTokens: 10, outputTokens: 5, costUsd: null },
        2,
      ),
    )
    await queue.idle()
    expect(rows.get(1)).toEqual({
      status: 'failed',
      failure: {
        error: { code: 'provider_invalid_output', message: 'Invalid answer' },
        rawResponse: 'raw text',
        inputTokens: 10,
        outputTokens: 5,
        costUsd: null,
      },
    })
  })

  it('leaves jobs pending on shutdown and runs them after a restart', async () => {
    const pending = [job(1), job(2), job(3, 'codex-cli')]
    const memory = memoryStore(pending)
    const runner = controlledRunner()
    const first = new AnalysisQueue({ store: memory.store, run: runner.run })
    expect(await first.restore()).toBe(3)
    await flush()
    await first.shutdown()
    expect(runner.runs.map((run) => run.signal.aborted)).toEqual([true, true])
    expect(pending.map((item) => memory.status(item.analysisId))).toEqual([
      'running',
      'queued',
      'running',
    ])
    expect(first.enqueue([job(4)])).toBe(0)

    const second = new AnalysisQueue({ store: memory.store, run: instantRunner })
    expect(await second.restore()).toBe(3)
    await second.idle()
    expect(pending.map((item) => memory.status(item.analysisId))).toEqual(['done', 'done', 'done'])
  })

  it('stores a result it cannot write as failed, without asking the provider again', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { store, rows } = memoryStore()
    const run = vi.fn(instantRunner)
    const queue = new AnalysisQueue({
      store: {
        ...store,
        markDone: () => {
          throw new Error('Disk full')
        },
      },
      run,
      storeRetryMs: 0,
    })
    queue.enqueue([job(1), job(2)])
    await queue.idle()
    expect(run).toHaveBeenCalledTimes(2)
    expect(rows.get(1)).toMatchObject({
      status: 'failed',
      failure: {
        error: { code: 'storage_unavailable' },
        rawResponse: '{}',
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      },
    })
    expect(rows.get(2)?.status).toBe('failed')
    // Two attempts per job before it is stored as failed.
    expect(logged).toHaveBeenCalledTimes(4)
  })

  it('reports the listings of a cancel at once', async () => {
    const changes: string[][] = []
    const queue = new AnalysisQueue({
      store: memoryStore().store,
      run: controlledRunner().run,
      onStatusChange: (edictIds) => changes.push(edictIds),
    })
    queue.enqueue([job(1), job(2), job(3)])
    await flush()
    changes.length = 0
    expect(queue.owns(3)).toBe(true)

    expect(await queue.cancel({ all: true })).toBe(3)
    expect(queue.owns(3)).toBe(false)
    await queue.idle()
    // The waiting jobs in one call; the running one when its run has stopped.
    expect(changes).toHaveLength(2)
    expect(changes).toContainEqual([job(2).edictId, job(3).edictId])
    expect(changes).toContainEqual([job(1).edictId])
  })
})
