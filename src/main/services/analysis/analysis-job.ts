import { readFile } from 'node:fs/promises'
import { AppError, isAppError } from '@shared/errors'
import type { ProviderId, ProviderStatus } from '@shared/providers'
import type { AnalysisJobRunner, AnalysisJobStep } from '../../ai/analysis/batch'
import { runAnalysis } from '../../ai/analysis/pipeline'
import type { RenderPages } from '../../ai/analysis/types'
import type { AiProvider } from '../../ai/provider'
import type { AppDocumentStore } from '../../db/document-store'
import { resolveDocumentFile } from '../../documents/document-protocol'
import type { RasterResult } from '../../documents/raster-protocol'
import { log } from '../../log'
import type { DocumentService } from '../documents'

// One analysis job: the Langgutachten downloaded and read when needed, then runAnalysis.

export interface ActiveProvider {
  provider: AiProvider
  model: string
  status: ProviderStatus
}

/** Implemented by the providers service. */
export interface ActiveProviderSource {
  /**
   * The selected, ready provider and the model to use. Throws provider_not_selected
   * or provider_not_connected, and `cancelled` once `signal` aborts.
   */
  active(signal?: AbortSignal): Promise<ActiveProvider>
  /** Calls `listener` with the new selection after it changed. Returns the unsubscribe function. */
  onSelectionChange(listener: (selected: ProviderId | null) => void): () => void
}

/** `renderPdfPages` from src/main/documents/raster.ts with the raster page location bound. */
export type RenderPdf = (options: {
  pdf: Uint8Array
  pages: readonly number[]
  signal: AbortSignal
}) => Promise<RasterResult>

export interface JobRunnerDeps {
  store: Pick<AppDocumentStore, 'langgutachten' | 'pageTexts'>
  documents: Pick<DocumentService, 'prepare'>
  providers: ActiveProviderSource
  renderPdf: RenderPdf
  /** The documents folder (AppPaths.documents). */
  documentsDir: string
}

export function createJobRunner(deps: JobRunnerDeps): AnalysisJobRunner {
  return async (job, signal, onStep) => {
    let current: AnalysisJobStep | null = null
    // Streaming providers report every few tokens; the screens need step changes only.
    const step = (next: AnalysisJobStep): void => {
      if (next === current) return
      current = next
      onStep(next)
    }
    const { provider } = await deps.providers.active(signal)
    // A job keeps its provider (batch.ts), and only the selected one can be reached.
    if (provider.id !== job.provider) {
      throw new AppError('provider_not_selected', `The job was queued for ${job.provider}`)
    }
    const gutachten = deps.store.langgutachten([job.edictId]).get(job.edictId)
    if (gutachten === undefined) throw new AppError('not_found', 'The listing has no Langgutachten')
    const document = await deps.documents.prepare(gutachten.id, signal, (pipelineStep) => {
      step(pipelineStep === 'download' ? 'downloading' : 'reading')
    })
    const { localPath } = document.row
    if (localPath === null) throw new AppError('not_found', 'The Gutachten file is missing')
    step('reading')
    return runAnalysis(
      {
        provider,
        model: job.model,
        imagesSupported: await modelTakesImages(provider, job.model, signal),
        edict: document.facts,
        pages: deps.store.pageTexts(document.row.id),
        renderPages: renderFrom(localPath, deps),
      },
      signal,
      (event) => step(event.step),
    )
  }
}

/** Whether the provider lists the model as accepting page images. */
export async function modelTakesImages(
  provider: AiProvider,
  model: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const options = await provider.models(signal)
    return options.some((option) => option.id === model && option.supportsImages)
  } catch (error) {
    if (signal?.aborted === true) throw new AppError('cancelled', 'Analysis cancelled')
    // Without the list, scanned pages count as unread instead of failing the job.
    log.warn('analysis', 'Could not list models', isAppError(error) ? error.code : undefined)
    return false
  }
}

function renderFrom(
  localPath: string,
  deps: Pick<JobRunnerDeps, 'renderPdf' | 'documentsDir'>,
): RenderPages {
  return async (pages, signal) => {
    const file = await resolveDocumentFile(deps.documentsDir, localPath)
    if (file === null) throw new AppError('not_found', 'The Gutachten file is missing')
    const { images } = await deps.renderPdf({ pdf: await readFile(file), pages, signal })
    return images.map((image) => ({ page: image.page, data: image.data }))
  }
}
