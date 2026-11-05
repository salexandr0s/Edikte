import type { AnalysisRecord } from '@shared/analysis-schema'
import type {
  AnalysisProgress,
  AreaEstimate,
  AreaValue,
  DocumentInfo,
  DocumentProgress,
  FillPlan,
  ListingQuery,
  ListingRow,
} from '@shared/domain'
import { EDIKTE_ORIGIN, EX_DB_PATH } from '@shared/edikte-codes'
import type { DocumentKind } from '@shared/enums'
import { AppError } from '@shared/errors'
import { applyListingQuery } from '@shared/listing-query'
import { PROVIDER_KINDS } from '@shared/providers'
import {
  MOCK_PROMPT_VERSION,
  failedRecord,
  fakeAnalysisRecord,
  queuedRecord,
  rowWithAnalyses,
  sqmText,
} from './mock-analysis'
import { delay, type Emit, type MockHandlers, type MockState } from './mock-core'

// Downloads, "Fill missing areas" and the analysis queue for the mock bridge.
// Jobs run on timers and report progress through the same events as main.
// Analyses of commercial listings fail, so the error path has data too.

const TOKENS_IN_PER_GUTACHTEN = 96_000
const TOKENS_OUT_PER_GUTACHTEN = 8_000
const USD_PER_GUTACHTEN = 0.68
const DOWNLOAD_TICKS = 5

type AnalysisStep = NonNullable<AnalysisProgress['step']>

const STEP_MS: Readonly<Record<AnalysisStep, number>> = {
  waiting: 0,
  downloading: 1500,
  reading: 800,
  rendering: 1000,
  asking: 3000,
  checking: 500,
}

export function createJobHandlers(
  state: MockState,
  emit: Emit,
  visibleRows: () => ListingRow[],
): MockHandlers {
  const downloading = new Set<number>()
  let fill: { cancelled: boolean } | null = null
  /** Analysis IDs waiting to run, oldest first. */
  const queue: number[] = []
  const cancelRequested = new Set<number>()
  let queueRunning = false

  const rowFor = (edictId: string): ListingRow => {
    const row = state.rows.find((candidate) => candidate.id === edictId)
    if (row === undefined) throw new AppError('not_found', `No mock listing ${edictId}`)
    return row
  }
  const documentFor = (documentId: number): DocumentInfo => {
    const doc = state.documents.find((candidate) => candidate.id === documentId)
    if (doc === undefined) throw new AppError('not_found', `No mock document ${documentId}`)
    return doc
  }
  const gutachtenFor = (edictId: string) =>
    state.documents.find((doc) => doc.edictId === edictId && doc.kind === 'langgutachten')

  /** Rebuilds rows from their documents and analyses, then tells the screens. */
  const refreshRows = (edictIds: string[]) => {
    state.rows = state.rows.map((row) =>
      edictIds.includes(row.id) ? rowWithAnalyses(row, state.analyses, state.documents) : row,
    )
    emit('listings:changed', { edictIds })
  }

  /** Marks a document as downloaded and runs the local m² estimate on it. */
  const finishDownload = (doc: DocumentInfo) => {
    const downloaded: DocumentInfo = {
      ...doc,
      ...downloadedPages(doc),
      downloaded: true,
      downloadedAt: new Date().toISOString(),
    }
    state.documents = state.documents.map((candidate) =>
      candidate.id === doc.id ? downloaded : candidate,
    )
    const row = rowFor(doc.edictId)
    const id = Math.max(0, ...state.estimates.map((estimate) => estimate.id)) + 1
    const estimate = localEstimate(row, downloaded, id)
    if (estimate !== null) {
      state.estimates.push(estimate)
      if (row.area === null) {
        const { sqm, kind, page, quote } = estimate
        const area: AreaValue = {
          sqm,
          kind,
          source: 'local_estimate',
          page,
          quote,
          documentId: doc.id,
        }
        state.rows = state.rows.map((candidate) =>
          candidate.id === row.id ? { ...candidate, area } : candidate,
        )
      }
    }
    refreshRows([row.id])
  }

  /** Download, text extraction and estimate, reported as documents:progress. */
  const transfer = async (
    doc: DocumentInfo,
    progress: Pick<DocumentProgress, 'job' | 'done' | 'total'>,
    isCancelled: () => boolean,
  ): Promise<boolean> => {
    if (documentFor(doc.id).downloaded || downloading.has(doc.id)) return true
    downloading.add(doc.id)
    try {
      const base = { ...progress, documentId: doc.id, edictId: doc.edictId }
      const bytesTotal = (doc.statedSizeKb ?? 1000) * 1024
      for (let tick = 0; tick <= DOWNLOAD_TICKS; tick++) {
        if (isCancelled()) return false
        const bytesDone = Math.round((bytesTotal * tick) / DOWNLOAD_TICKS)
        emit('documents:progress', { ...base, phase: 'download', bytesDone, bytesTotal })
        await delay(250)
      }
      for (const phase of ['extract', 'estimate'] as const) {
        if (isCancelled()) return false
        emit('documents:progress', { ...base, phase, bytesDone: null, bytesTotal: null })
        await delay(400)
      }
      finishDownload(doc)
      return true
    } finally {
      downloading.delete(doc.id)
    }
  }

  /** A single download, as started by documents:download or documents:open. */
  const downloadOne = async (documentId: number): Promise<DocumentInfo> => {
    const doc = documentFor(documentId)
    if (doc.downloaded) return doc
    if (downloading.has(documentId)) {
      throw new AppError('busy', 'The document is already downloading')
    }
    await transfer(doc, { job: 'single', done: 0, total: 1 }, () => false)
    emit('documents:progress', {
      job: 'single',
      phase: 'done',
      documentId,
      edictId: doc.edictId,
      done: 1,
      total: 1,
      bytesDone: null,
      bytesTotal: null,
    })
    return documentFor(documentId)
  }

  /** Filtered listings without any area, and their Gutachten not downloaded yet. */
  const fillCandidates = (query: ListingQuery): { plan: FillPlan; documents: DocumentInfo[] } => {
    const rows = applyListingQuery(visibleRows(), { ...query, includeWithoutArea: true }).rows
    const withoutArea = rows.filter((row) => row.area === null)
    const documents = withoutArea.flatMap((row) => {
      const doc = gutachtenFor(row.id)
      return doc === undefined || doc.downloaded ? [] : [doc]
    })
    const totalKb = documents.reduce((sum, doc) => sum + (doc.statedSizeKb ?? 0), 0)
    return {
      plan: { listings: withoutArea.length, documents: documents.length, totalKb },
      documents,
    }
  }

  const runFill = async (documents: DocumentInfo[], job: { cancelled: boolean }) => {
    const total = documents.length
    let done = 0
    for (const doc of documents) {
      if (!(await transfer(doc, { job: 'fill', done, total }, () => job.cancelled))) break
      done += 1
    }
    fill = null
    emit('documents:progress', {
      job: 'fill',
      phase: job.cancelled ? 'cancelled' : 'done',
      documentId: null,
      edictId: null,
      done,
      total,
      bytesDone: null,
      bytesTotal: null,
    })
  }

  const report = (record: AnalysisRecord, step: AnalysisProgress['step']) => {
    emit('analysis:progress', {
      analysisId: record.id,
      edictId: record.edictId,
      status: record.status,
      step,
      queued: queue.length,
    })
  }

  const saveRecord = (record: AnalysisRecord) => {
    state.analyses = state.analyses.map((candidate) =>
      candidate.id === record.id ? record : candidate,
    )
    refreshRows([record.edictId])
  }

  const finishRecord = (record: AnalysisRecord) => {
    cancelRequested.delete(record.id)
    saveRecord(record)
    report(record, null)
  }

  const cancelRecord = (record: AnalysisRecord) => {
    finishRecord({ ...record, status: 'cancelled', finishedAt: new Date().toISOString() })
  }

  /** Waits in short slices, so a cancel takes effect within 100 ms. */
  const wait = async (ms: number, analysisId: number): Promise<boolean> => {
    for (let waited = 0; waited < ms; waited += 100) {
      if (cancelRequested.has(analysisId)) return false
      await delay(100)
    }
    return !cancelRequested.has(analysisId)
  }

  const runJob = async (queued: AnalysisRecord) => {
    const running: AnalysisRecord = {
      ...queued,
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    saveRecord(running)
    const doc = gutachtenFor(running.edictId)
    const steps: AnalysisStep[] = ['downloading', 'reading', 'rendering', 'asking', 'checking']
    for (const step of steps) {
      const current = doc === undefined ? undefined : documentFor(doc.id)
      if (step === 'downloading' && (current === undefined || current.downloaded)) continue
      if (step === 'rendering' && current?.scannedPages.length === 0) continue
      report(running, step)
      if (!(await wait(STEP_MS[step], running.id))) return cancelRecord(running)
      if (step === 'downloading' && current !== undefined && !downloading.has(current.id)) {
        finishDownload(current)
      }
    }
    const row = rowFor(running.edictId)
    const { id, provider, model, createdAt } = running
    const finished =
      row.propertyType === 'commercial'
        ? failedRecord(row, id, provider, model, createdAt, {
            code: 'provider_incomplete',
            message: 'The answer stopped before the end',
          })
        : fakeAnalysisRecord(row, id, provider, model, createdAt)
    finishRecord({
      ...finished,
      startedAt: running.startedAt,
      finishedAt: new Date().toISOString(),
    })
  }

  const runQueue = async () => {
    if (queueRunning) return
    queueRunning = true
    try {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const record = state.analyses.find((candidate) => candidate.id === id)
        if (record?.status === 'queued') await runJob(record)
      }
    } finally {
      queueRunning = false
    }
  }

  return {
    'documents:download': ({ documentId }) => downloadOne(documentId),
    // Downloads when needed, like main. A browser has no PDF window to open.
    'documents:open': async ({ documentId }) => {
      await downloadOne(documentId)
    },
    'documents:planFill': (query) => fillCandidates(query).plan,
    'documents:fill': (query) => {
      if (fill !== null) throw new AppError('busy', 'Missing areas are already being filled')
      const { plan, documents } = fillCandidates(query)
      const job = { cancelled: false }
      fill = job
      void runFill(documents, job)
      return plan
    },
    'documents:cancelFill': () => {
      if (fill !== null) fill.cancelled = true
    },

    'analysis:estimate': ({ edictIds }) => {
      const rows = [...new Set(edictIds)].map(rowFor)
      const gutachten = rows.flatMap((row) => {
        const doc = gutachtenFor(row.id)
        return doc === undefined ? [] : [doc]
      })
      const provider = state.providers.find((candidate) => candidate.selected) ?? null
      const paid = provider !== null && PROVIDER_KINDS[provider.id] === 'api_key'
      const alreadyAnalyzed = rows.filter((row) =>
        state.analyses.some(
          (record) =>
            record.edictId === row.id &&
            record.status === 'done' &&
            record.promptVersion === MOCK_PROMPT_VERSION,
        ),
      ).length
      return {
        listings: rows.length,
        alreadyAnalyzed,
        withoutDocument: rows.length - gutachten.length,
        downloadKb: gutachten
          .filter((doc) => !doc.downloaded)
          .reduce((sum, doc) => sum + (doc.statedSizeKb ?? 0), 0),
        inputTokens: gutachten.length * TOKENS_IN_PER_GUTACHTEN,
        outputTokens: gutachten.length * TOKENS_OUT_PER_GUTACHTEN,
        costUsd: paid ? Math.round(gutachten.length * USD_PER_GUTACHTEN * 100) / 100 : null,
        provider: provider?.id ?? null,
        model: provider?.model ?? null,
      }
    },
    /** Queues every listing with a Langgutachten that has no queued or running analysis. */
    'analysis:start': ({ edictIds }) => {
      if (state.settings.analysisConsentAt === null) {
        throw new AppError('consent_required', 'Sending Gutachten text was not accepted yet')
      }
      const provider = state.providers.find((candidate) => candidate.selected)
      if (provider === undefined) throw new AppError('provider_not_selected', 'No provider')
      if (provider.state !== 'ready') {
        throw new AppError('provider_not_connected', `${provider.id} is not ready`)
      }
      const createdAt = new Date().toISOString()
      const added: AnalysisRecord[] = []
      for (const edictId of new Set(edictIds)) {
        const row = rowFor(edictId)
        const pending = state.analyses.some(
          (record) =>
            record.edictId === edictId &&
            (record.status === 'queued' || record.status === 'running'),
        )
        if (pending || gutachtenFor(row.id) === undefined) continue
        const id = Math.max(0, ...state.analyses.map((record) => record.id)) + 1
        const record = queuedRecord(
          edictId,
          id,
          provider.id,
          provider.model ?? 'default',
          createdAt,
        )
        state.analyses.push(record)
        queue.push(id)
        added.push(record)
      }
      if (added.length > 0) refreshRows(added.map((record) => record.edictId))
      for (const record of added) report(record, 'waiting')
      void runQueue()
      return { queued: added.length }
    },
    'analysis:cancel': (target) => {
      const all = 'all' in target
      const records = state.analyses.filter((record) =>
        all
          ? record.status === 'queued' || record.status === 'running'
          : record.id === target.analysisId,
      )
      if (!all && records.length === 0) throw new AppError('not_found', 'No such analysis')
      for (const record of records) {
        if (record.status === 'queued') {
          const position = queue.indexOf(record.id)
          if (position >= 0) queue.splice(position, 1)
          cancelRecord(record)
        } else if (record.status === 'running') {
          cancelRequested.add(record.id)
        }
      }
    },
    /** Newest first. */
    'analysis:list': ({ edictId }) =>
      state.analyses.filter((record) => record.edictId === edictId).reverse(),
  }
}

const GUTACHTEN_KB = [7360, 8120, 9480, 6900, 7700, 10_240, 5200, 7010, 8800]

/**
 * The Langgutachten of every listing that has one, with ID = listing number,
 * plus photos for the first listing and a plan for the house. The documents
 * of the three analyzed listings are downloaded.
 */
export function fakeDocuments(rows: readonly ListingRow[]): DocumentInfo[] {
  const documents = rows.flatMap((row, index) => {
    if (!row.hasLanggutachten) return []
    const kb = GUTACHTEN_KB[index % GUTACHTEN_KB.length] ?? 7000
    const doc = fakeDocument(row, index + 1, 'langgutachten', 'Langgutachten', kb)
    if (index >= 3) return [doc]
    const downloadedAt = '2026-11-04T09:10:00.000Z'
    return [{ ...doc, ...downloadedPages(doc), downloaded: true, downloadedAt }]
  })
  const [first, , house] = rows
  if (first !== undefined) documents.push(fakeDocument(first, 101, 'photo', 'Foto', 2150))
  if (house !== undefined) documents.push(fakeDocument(house, 102, 'plan', 'Plan', 840))
  return documents
}

/** Local estimates for the documents that start out downloaded. */
export function fakeEstimates(
  rows: readonly ListingRow[],
  documents: readonly DocumentInfo[],
): AreaEstimate[] {
  return documents.flatMap((doc) => {
    const row = rows.find((candidate) => candidate.id === doc.edictId)
    const estimate = doc.downloaded && row !== undefined ? localEstimate(row, doc, doc.id) : null
    return estimate === null ? [] : [estimate]
  })
}

function fakeDocument(
  row: ListingRow,
  id: number,
  kind: DocumentKind,
  label: string,
  kb: number,
): DocumentInfo {
  const fileName = `${label.toLowerCase()}.pdf`
  return {
    id,
    edictId: row.id,
    kind,
    title: label,
    fileName,
    url: `${EDIKTE_ORIGIN}${EX_DB_PATH}/0/${row.id}/$file/${fileName}`,
    statedSizeKb: kb,
    downloaded: false,
    downloadedAt: null,
    pageCount: null,
    scannedPages: [],
    extractError: null,
  }
}

/** Every second Gutachten ends with scanned appendix pages; photos and plans are all images. */
function downloadedPages(doc: DocumentInfo): Pick<DocumentInfo, 'pageCount' | 'scannedPages'> {
  const pageCount = doc.kind === 'langgutachten' ? 36 + ((doc.id * 5) % 18) : 6
  const firstScanned = doc.kind !== 'langgutachten' ? 1 : doc.id % 2 === 1 ? pageCount - 3 : null
  if (firstScanned === null) return { pageCount, scannedPages: [] }
  const scannedPages = Array.from(
    { length: pageCount - firstScanned + 1 },
    (_, offset) => firstScanned + offset,
  )
  return { pageCount, scannedPages }
}

/** What the text scan would find: the listing's own area, or a made-up one when it states none. */
function localEstimate(row: ListingRow, doc: DocumentInfo, id: number): AreaEstimate | null {
  if (doc.kind !== 'langgutachten' || row.propertyType === 'land') return null
  const sqm = row.area?.sqm ?? 55 + ((doc.id * 17) % 40)
  const kind = row.propertyType === 'house' ? 'wohnflaeche' : 'nutzflaeche'
  const label = kind === 'wohnflaeche' ? 'Wohnfläche' : 'Nutzfläche'
  return {
    id,
    documentId: doc.id,
    kind,
    sqm,
    page: 9,
    quote: `${label} gesamt ${sqmText(sqm)} m²`,
    confidence: 'medium',
  }
}
