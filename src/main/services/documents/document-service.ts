import type {
  DocumentInfo,
  DocumentProgress,
  FillPlan,
  ListingPage,
  ListingQuery,
} from '@shared/domain'
import { AppError, isAppError } from '@shared/errors'
import {
  toPipelineDocument,
  type AppDocumentStore,
  type StoredDocument,
} from '../../db/document-store'
import { resolveDocumentFile } from '../../documents/document-protocol'
import type { DownloadProgress } from '../../documents/download'
import type { ExtractedDocument } from '../../documents/extract'
import {
  createFillRunner,
  planFill,
  type FillCandidate,
  type FillOutcome,
} from '../../documents/fill'
import {
  processDocument,
  type DocumentStore,
  type PipelineDeps,
  type PipelineStep,
} from '../../documents/pipeline'
import { deleteDocumentFiles, selectExpiredDocuments } from '../../documents/retention'
import type { EmitEvent } from '../../ipc/events'
import { log } from '../../log'

// Downloads, "Fill missing areas", the PDF window and retention behind the
// documents:* channels. Every download runs processDocument: the file, its
// text from the utility process, then the local m² estimate.

/** What openPdfWindow takes. */
export interface OpenPdfRequest {
  documentsDir: string
  localPath: string
  page?: number
  title?: string
}

export type PrepareStep = (step: PipelineStep, bytes: DownloadProgress | null) => void

export interface DocumentServiceDeps {
  store: AppDocumentStore
  /** The documents folder (AppPaths.documents). */
  documentsDir: string
  emit: EmitEvent
  /** Reads a PDF in the utility process: `(file, signal) => extractInUtilityProcess(file, { signal })`. */
  extract: (absolutePath: string, signal: AbortSignal) => Promise<ExtractedDocument>
  /** The EdikteClient's `limitedFetch`, so downloads share the sync's queue and pace. */
  fetch: typeof globalThis.fetch
  /** `userAgent(appVersion)` from src/main/scraper/client.ts. */
  userAgent: string
  /** `openPdfWindow` from src/main/documents/pdf-window.ts. */
  openPdf: (options: OpenPdfRequest) => Promise<void>
  /** The listings a query shows, as `listings:query` returns them. */
  queryListings: (query: ListingQuery) => ListingPage | Promise<ListingPage>
  /** Settings.documentRetentionDays, read on each retention run. */
  retentionDays: () => number
  now?: () => Date
}

export interface RetentionSummary {
  deleted: number
  missing: number
  refused: number
}

export interface DocumentService {
  download(request: { documentId: number }): Promise<DocumentInfo>
  /** Downloads the document first when needed. */
  open(request: { documentId: number; page?: number | undefined }): Promise<void>
  planFill(query: ListingQuery): Promise<FillPlan>
  /** Starts "Fill missing areas" and returns its plan; fails with `busy` while one runs. */
  fill(query: ListingQuery): Promise<FillPlan>
  cancelFill(): void
  /** Deletes the files of cases closed for longer than the retention setting. */
  runRetention(): Promise<RetentionSummary>
  /** Downloads and reads a document unless that is done; analysis jobs call it. */
  prepare(documentId: number, signal: AbortSignal, onStep?: PrepareStep): Promise<StoredDocument>
  /** Settles when no download or fill is running. */
  idle(): Promise<void>
}

export function createDocumentService(deps: DocumentServiceDeps): DocumentService {
  const { store, emit, documentsDir } = deps
  const now = deps.now ?? (() => new Date())
  /** Downloads in progress by document ID; a second request joins the first. */
  const preparing = new Map<number, Promise<StoredDocument>>()

  const changed = (documentId: number): void => {
    const edictId = store.edictIdOf(documentId)
    if (edictId !== null) emit('listings:changed', { edictIds: [edictId] })
  }
  // The pipeline writes through this store, so every change reaches the screens.
  const notifyingStore: DocumentStore = {
    recordDownload: (documentId, patch) => {
      store.recordDownload(documentId, patch)
      changed(documentId)
    },
    recordPages: (documentId, patch, pages) => {
      store.recordPages(documentId, patch, pages)
    },
    recordExtractError: (documentId, patch) => {
      store.recordExtractError(documentId, patch)
      changed(documentId)
    },
    replaceEstimates: (documentId, rows) => {
      store.replaceEstimates(documentId, rows)
      changed(documentId)
    },
  }
  const pipeline: PipelineDeps = {
    documentsDir,
    store: notifyingStore,
    extract: deps.extract,
    fetch: deps.fetch,
    userAgent: deps.userAgent,
    now,
  }
  const fillRunner = createFillRunner(
    pipeline,
    (progress) => emit('documents:progress', progress),
    logFillOutcome,
  )

  const requireDocument = (documentId: number): StoredDocument => {
    const stored = store.find(documentId)
    if (stored === null) throw new AppError('not_found', `No document ${documentId}`)
    return stored
  }

  /** Downloaded, read, and the file is still in the documents folder. */
  const isReady = async ({ row }: StoredDocument): Promise<boolean> =>
    row.localPath !== null &&
    row.extractedAt !== null &&
    (await resolveDocumentFile(documentsDir, row.localPath)) !== null

  const prepare = (
    documentId: number,
    signal: AbortSignal,
    onStep?: PrepareStep,
  ): Promise<StoredDocument> => {
    const joined = preparing.get(documentId)
    if (joined !== undefined) return joined
    const run = (async () => {
      const stored = requireDocument(documentId)
      if (await isReady(stored)) return stored
      await processDocument(toPipelineDocument(stored), pipeline, { signal, onStep })
      return requireDocument(documentId)
    })()
    preparing.set(documentId, run)
    const forget = (): void => {
      preparing.delete(documentId)
    }
    run.then(forget, forget)
    return run
  }

  const download = async (documentId: number): Promise<DocumentInfo> => {
    const stored = requireDocument(documentId)
    if (await isReady(stored)) return stored.info
    const report = (
      phase: DocumentProgress['phase'],
      done: number,
      bytes: DownloadProgress | null = null,
    ): void => {
      emit('documents:progress', {
        job: 'single',
        phase,
        documentId,
        edictId: stored.row.edictId,
        done,
        total: 1,
        bytesDone: bytes?.bytesDone ?? null,
        bytesTotal: bytes?.bytesTotal ?? null,
      })
    }
    try {
      // A single download has no cancel button; its own timeout ends a stuck one.
      const ready = await prepare(documentId, new AbortController().signal, (step, bytes) =>
        report(step, 0, bytes),
      )
      report('done', 1)
      return ready.info
    } catch (error) {
      report(isAppError(error) && error.code === 'cancelled' ? 'cancelled' : 'failed', 0)
      throw error
    }
  }

  /** Listings of the query without any area, each with its Langgutachten. */
  const fillCandidates = async (query: ListingQuery): Promise<FillCandidate[]> => {
    const { rows } = await deps.queryListings({ ...query, includeWithoutArea: true })
    const withoutArea = rows.filter((row) => row.area === null)
    const gutachten = store.langgutachten(withoutArea.map((row) => row.id))
    return withoutArea.map((row) => {
      const document = gutachten.get(row.id)
      return {
        edictId: row.id,
        propertyType: row.propertyType,
        document:
          document === undefined
            ? null
            : {
                id: document.id,
                url: document.url,
                fileName: document.fileName,
                statedSizeKb: document.statedSizeKb,
                localPath: document.localPath,
              },
      }
    })
  }

  return {
    download: ({ documentId }) => download(documentId),
    async open({ documentId, page }) {
      await download(documentId)
      const { row, edictTitle } = requireDocument(documentId)
      if (row.localPath === null) throw new AppError('not_found', 'The document file is missing')
      await deps.openPdf({ documentsDir, localPath: row.localPath, page, title: edictTitle })
    },
    async planFill(query) {
      return planFill(await fillCandidates(query))
    },
    async fill(query) {
      if (fillRunner.running) throw new AppError('busy', 'Missing areas are already being filled')
      const candidates = await fillCandidates(query)
      // A Gutachten already on disk has been read: another pass finds nothing new.
      fillRunner.start(
        candidates.filter(
          (candidate) => candidate.document !== null && candidate.document.localPath === null,
        ),
      )
      return planFill(candidates)
    },
    cancelFill: () => fillRunner.cancel(),
    async runRetention() {
      const expired = selectExpiredDocuments(store.retentionCandidates(), {
        retentionDays: deps.retentionDays(),
        now: now(),
      })
      // A file being downloaded or read right now waits for the next run.
      const targets = expired.flatMap(({ documentId, localPath }) =>
        localPath === null || preparing.has(documentId) ? [] : [{ documentId, localPath }],
      )
      if (targets.length === 0) return { deleted: 0, missing: 0, refused: 0 }
      const outcome = await deleteDocumentFiles(
        documentsDir,
        targets.map((target) => target.localPath),
      )
      const gone = new Set([...outcome.deleted, ...outcome.missing])
      const edictIds = store.clearDownloads(
        targets.filter((target) => gone.has(target.localPath)).map((target) => target.documentId),
      )
      if (edictIds.length > 0) emit('listings:changed', { edictIds })
      return {
        deleted: outcome.deleted.length,
        missing: outcome.missing.length,
        refused: outcome.refused.length,
      }
    },
    prepare,
    async idle() {
      await Promise.allSettled([...preparing.values()])
      await fillRunner.idle()
    },
  }
}

function logFillOutcome(outcome: FillOutcome): void {
  if (outcome.failures.length === 0) return
  // Codes only: messages may quote the site.
  log.warn(
    'documents',
    `Fill missing areas skipped ${outcome.failures.length} documents`,
    outcome.failures.map((failure) => failure.code),
  )
}
