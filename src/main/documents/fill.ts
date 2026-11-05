import type { DocumentProgress, FillPlan } from '@shared/domain'
import type { PropertyType } from '@shared/enums'
import { AppError, isAppError, type AppErrorCode } from '@shared/errors'
import type { DownloadProgress } from './download'
import type { PipelineDocument, PipelineStep } from './pipeline'

// "Fill missing areas": for listings without any area, download the
// Langgutachten, read it and run the local m² estimate, one document at a time.

export interface FillCandidate {
  edictId: string
  propertyType: PropertyType
  /** The listing's Langgutachten; null when it has none. */
  document: Omit<PipelineDocument, 'edictId' | 'propertyType'> | null
}

/** Counts for the confirmation dialog: listings, downloads and their stated size. */
export function planFill(candidates: readonly FillCandidate[]): FillPlan {
  let documents = 0
  let totalKb = 0
  for (const candidate of candidates) {
    if (candidate.document === null || candidate.document.localPath !== null) continue
    documents += 1
    totalKb += candidate.document.statedSizeKb ?? 0
  }
  return { listings: candidates.length, documents, totalKb }
}

export interface FillOutcome {
  status: 'done' | 'cancelled' | 'failed'
  /** Documents read to the end. */
  processed: number
  /** Documents that produced an estimate. */
  estimated: number
  failures: { documentId: number; code: AppErrorCode }[]
}

/** Errors after which every later document would fail as well. */
const STOPPING_CODES: ReadonlySet<AppErrorCode> = new Set([
  'storage_unavailable',
  'rate_limited',
  'site_unavailable',
])

/**
 * Downloads, reads and estimates one listing's Langgutachten. The document
 * service passes its shared runs, so a fill never fetches a file that a single
 * download or an analysis is already fetching.
 */
export type FillDocument = (
  target: { documentId: number; edictId: string },
  signal: AbortSignal,
  onStep: (step: PipelineStep, bytes: DownloadProgress | null) => void,
) => Promise<{ estimated: boolean }>

/**
 * Runs the fill sequentially. A failing document is recorded and skipped;
 * cancellation stops before the next step. An unwritable documents folder and
 * a site that answers 429 or is unavailable stop the whole run.
 */
export async function runFill(
  candidates: readonly FillCandidate[],
  fillDocument: FillDocument,
  options: { signal: AbortSignal; onProgress?: (progress: DocumentProgress) => void },
): Promise<FillOutcome> {
  const queue = candidates.filter((candidate) => candidate.document !== null)
  const total = queue.length
  const outcome: FillOutcome = { status: 'done', processed: 0, estimated: 0, failures: [] }
  let done = 0
  const emit = (
    phase: DocumentProgress['phase'],
    target: { documentId: number; edictId: string } | null,
    bytes: DownloadProgress | null = null,
  ): void => {
    options.onProgress?.({
      job: 'fill',
      phase,
      documentId: target?.documentId ?? null,
      edictId: target?.edictId ?? null,
      done,
      total,
      bytesDone: bytes?.bytesDone ?? null,
      bytesTotal: bytes?.bytesTotal ?? null,
    })
  }

  for (const candidate of queue) {
    if (options.signal.aborted || candidate.document === null) break
    const target = { documentId: candidate.document.id, edictId: candidate.edictId }
    try {
      const result = await fillDocument(target, options.signal, (step, bytes) =>
        emit(step, target, bytes),
      )
      outcome.processed += 1
      if (result.estimated) outcome.estimated += 1
    } catch (error) {
      const code: AppErrorCode = isAppError(error) ? error.code : 'internal'
      if (code === 'cancelled' || options.signal.aborted) break
      outcome.failures.push({ documentId: target.documentId, code })
      if (STOPPING_CODES.has(code)) {
        outcome.status = 'failed'
        emit('failed', target)
        return outcome
      }
    }
    done += 1
  }
  outcome.status = options.signal.aborted ? 'cancelled' : 'done'
  emit(outcome.status, null)
  return outcome
}

export interface FillRunner {
  /** Starts a fill and returns its plan; fails with `busy` while one runs. */
  start(candidates: readonly FillCandidate[]): FillPlan
  cancel(): void
  readonly running: boolean
  /** Settles when the current fill has finished. */
  idle(): Promise<void>
}

/** One fill at a time, cancellable, reporting through `onProgress`. */
export function createFillRunner(
  fillDocument: FillDocument,
  onProgress: (progress: DocumentProgress) => void,
  onFinished?: (outcome: FillOutcome) => void,
): FillRunner {
  let controller: AbortController | null = null
  let current: Promise<void> = Promise.resolve()
  return {
    start(candidates) {
      if (controller !== null) throw new AppError('busy', 'A fill is already running')
      const plan = planFill(candidates)
      const own = new AbortController()
      controller = own
      current = runFill(candidates, fillDocument, { signal: own.signal, onProgress })
        .then((outcome) => onFinished?.(outcome))
        .finally(() => {
          if (controller === own) controller = null
        })
      return plan
    },
    cancel() {
      controller?.abort()
    },
    get running() {
      return controller !== null
    },
    idle() {
      return current
    },
  }
}
