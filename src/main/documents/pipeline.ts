import { AppError, isAppError } from '@shared/errors'
import type { PropertyType } from '@shared/enums'
import type { areaEstimates, documentPages } from '../db/schema'
import { resolveDocumentFile } from './document-protocol'
import { downloadDocument, type DownloadProgress } from './download'
import { estimateArea, type LocalAreaEstimate } from './estimate'
import type { ExtractedDocument } from './extract'

// One document from download to local estimate. The database stays behind
// DocumentStore, which the lead implements with the repositories.

export type DocumentPageRow = Omit<typeof documentPages.$inferInsert, 'id'>
export type AreaEstimateRow = Omit<typeof areaEstimates.$inferInsert, 'id'>

export interface PipelineDocument {
  /** documents.id */
  id: number
  edictId: string
  propertyType: PropertyType
  url: string
  fileName: string
  statedSizeKb: number | null
  /** documents.localPath; null until downloaded. */
  localPath: string | null
}

export interface DocumentStore {
  /** Sets these columns on the documents row. */
  recordDownload(
    documentId: number,
    patch: { localPath: string; sha256: string; bytes: number; downloadedAt: string },
  ): void | Promise<void>
  /** Replaces the document_pages rows and sets these columns on the documents row. */
  recordPages(
    documentId: number,
    patch: { pageCount: number; extractedAt: string; extractError: null },
    pages: DocumentPageRow[],
  ): void | Promise<void>
  recordExtractError(
    documentId: number,
    patch: { extractError: string; extractedAt: string },
  ): void | Promise<void>
  /** Replaces the area_estimates rows of the document; an empty list clears them. */
  replaceEstimates(documentId: number, rows: AreaEstimateRow[]): void | Promise<void>
}

export interface PipelineDeps {
  /** The documents folder (AppPaths.documents). */
  documentsDir: string
  store: DocumentStore
  /** Reads the pages of a file; in the app, extractInUtilityProcess. */
  extract: (absolutePath: string, signal: AbortSignal) => Promise<ExtractedDocument>
  /** Defaults to Node's global fetch; pass the scraper's rate-limited fetch to share its pace. */
  fetch?: typeof fetch
  userAgent?: string
  maxBytes?: number
  now?: () => Date
}

export type PipelineStep = 'download' | 'extract' | 'estimate'

export interface PipelineOptions {
  signal: AbortSignal
  onStep?: (step: PipelineStep, bytes: DownloadProgress | null) => void
}

export interface PipelineResult {
  localPath: string
  /** False when the file was already on disk. */
  downloaded: boolean
  pageCount: number
  estimate: LocalAreaEstimate | null
}

/** Downloads the file when needed, reads its pages and stores the local m² estimate. */
export async function processDocument(
  document: PipelineDocument,
  deps: PipelineDeps,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const now = deps.now ?? (() => new Date())
  const { signal } = options
  const stopIfCancelled = (): void => {
    if (signal.aborted) throw new AppError('cancelled', 'Cancelled')
  }
  stopIfCancelled()

  const stored = await storedFile(document, deps.documentsDir)
  let localPath: string
  let file: string
  if (stored !== null) {
    ;({ localPath, file } = stored)
  } else {
    options.onStep?.('download', { bytesDone: 0, bytesTotal: null })
    const result = await downloadDocument({
      url: document.url,
      edictId: document.edictId,
      // The id keeps two documents of one edict with the same name apart.
      fileName: `${document.id}-${document.fileName}`,
      documentsDir: deps.documentsDir,
      signal,
      onProgress: (bytes) => options.onStep?.('download', bytes),
      fetch: deps.fetch,
      maxBytes: deps.maxBytes,
      userAgent: deps.userAgent,
    })
    await deps.store.recordDownload(document.id, {
      localPath: result.localPath,
      sha256: result.sha256,
      bytes: result.bytes,
      downloadedAt: now().toISOString(),
    })
    localPath = result.localPath
    file = result.absolutePath
  }

  stopIfCancelled()
  options.onStep?.('extract', null)
  let extracted: ExtractedDocument
  try {
    extracted = await deps.extract(file, signal)
  } catch (error) {
    const code = isAppError(error) ? error.code : 'document_unreadable'
    if (code !== 'cancelled' && !signal.aborted) {
      await deps.store.recordExtractError(document.id, {
        extractError: code,
        extractedAt: now().toISOString(),
      })
    }
    throw error
  }
  await deps.store.recordPages(
    document.id,
    { pageCount: extracted.pageCount, extractedAt: now().toISOString(), extractError: null },
    extracted.pages.map((page) => ({
      documentId: document.id,
      pageNumber: page.pageNumber,
      printedLabel: page.printedLabel,
      hasText: page.hasText,
      text: page.text,
    })),
  )

  options.onStep?.('estimate', null)
  const estimate = estimateArea(extracted.pages, document.propertyType)
  await deps.store.replaceEstimates(
    document.id,
    estimate === null
      ? []
      : [
          {
            edictId: document.edictId,
            documentId: document.id,
            kind: estimate.kind,
            sqm: estimate.sqm,
            page: estimate.page,
            quote: estimate.quote,
            confidence: estimate.confidence,
            method: estimate.method,
            createdAt: now().toISOString(),
          },
        ],
  )
  return { localPath, downloaded: stored === null, pageCount: extracted.pageCount, estimate }
}

async function storedFile(
  document: PipelineDocument,
  documentsDir: string,
): Promise<{ localPath: string; file: string } | null> {
  if (document.localPath === null) return null
  const file = await resolveDocumentFile(documentsDir, document.localPath)
  return file === null ? null : { localPath: document.localPath, file }
}
