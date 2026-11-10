import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DocumentProgressSchema,
  ListingQuerySchema,
  type ListingQuery,
  type ListingRow,
} from '@shared/domain'
import { AppError } from '@shared/errors'
import { openDatabase, type AppDatabase } from '../../../src/main/db/client'
import { createDocumentStore } from '../../../src/main/db/document-store'
import { queryListings } from '../../../src/main/db/listing-store'
import { areaEstimates, documents, userState } from '../../../src/main/db/schema'
import type { ExtractedDocument } from '../../../src/main/documents/extract'
import type { EmitEvent } from '../../../src/main/ipc/events'
import { EdikteClient } from '../../../src/main/scraper/client'
import {
  createDocumentService,
  type DocumentServiceDeps,
  type OpenPdfRequest,
} from '../../../src/main/services/documents'
import { NOW, edictId, insertEdict, insertGutachten, listingRow, storeReadDocument } from './seed'

const QUERY: ListingQuery = ListingQuerySchema.parse({})

const AREA_DOCUMENT: ExtractedDocument = {
  pageCount: 2,
  pages: [
    { pageNumber: 1, text: 'Nutzfläche Wohnung: 70,00 m²', hasText: true, printedLabel: null },
    { pageNumber: 2, text: '', hasText: false, printedLabel: null },
  ],
}

const pdfFetch: typeof fetch = () => Promise.resolve(new Response('%PDF-1.4 stand-in'))

/** Answers only once the request is aborted, with an error. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })

/** Answers every request once released; a request fails once it is aborted. */
function gatedFetch() {
  let release = (): void => {}
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  const signals: AbortSignal[] = []
  const fetch: typeof globalThis.fetch = (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? null
      if (signal !== null) {
        signals.push(signal)
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }
      void opened.then(() => resolve(new Response('%PDF-1.4 stand-in')))
    })
  return { fetch, release, signals }
}

interface Emitted {
  event: string
  payload: unknown
}

let db: AppDatabase
let documentsDir: string

beforeEach(async () => {
  db = openDatabase(':memory:')
  documentsDir = await mkdtemp(path.join(tmpdir(), 'edikte-documents-'))
})

afterEach(async () => {
  db.$client.close()
  await rm(documentsDir, { recursive: true, force: true })
})

function setup(rows: ListingRow[] = [], overrides: Partial<DocumentServiceDeps> = {}) {
  const events: Emitted[] = []
  const queries: ListingQuery[] = []
  const opened: OpenPdfRequest[] = []
  const emit: EmitEvent = (event, payload) => {
    events.push({ event, payload })
  }
  const service = createDocumentService({
    store: createDocumentStore(db),
    documentsDir,
    emit,
    extract: () => Promise.resolve(AREA_DOCUMENT),
    fetch: pdfFetch,
    userAgent: 'Edikte tests',
    openPdf: (options) => {
      opened.push(options)
      return Promise.resolve()
    },
    queryListings: (query) => {
      queries.push(query)
      return { rows, totalInScope: rows.length }
    },
    retentionDays: () => 30,
    now: () => new Date(NOW),
    ...overrides,
  })
  const progress = () =>
    events
      .filter((emitted) => emitted.event === 'documents:progress')
      .map((emitted) => DocumentProgressSchema.parse(emitted.payload))
  return { service, events, queries, opened, progress }
}

describe('document service', () => {
  it.each([
    { label: 'a usable area', pages: AREA_DOCUMENT.pages, sqm: 70 },
    {
      label: 'no area',
      pages: [{ pageNumber: 1, printedLabel: null, hasText: true, text: 'No usable area stated' }],
      sqm: null,
    },
  ])(
    'refreshes a cached legacy estimate to $label once without downloading or re-extracting',
    async ({ pages, sqm }) => {
      const edict = edictId(203)
      insertEdict(db, edict, { bundesland: 'wien' })
      const documentId = insertGutachten(db, edict)
      await storeReadDocument(db, documentsDir, documentId, edict, pages)
      db.insert(areaEstimates)
        .values({
          edictId: edict,
          documentId,
          documentSha256: null,
          kind: 'nutzflaeche',
          sqm: 55,
          page: 1,
          quote: 'Old estimate',
          confidence: 'medium',
          method: 'legacy',
          createdAt: NOW,
        })
        .run()
      const store = createDocumentStore(db)
      const replace = vi.spyOn(store, 'replaceEstimates')
      const fetch = vi.fn<DocumentServiceDeps['fetch']>()
      const extract = vi.fn<DocumentServiceDeps['extract']>()
      const { service } = setup([], {
        store,
        fetch,
        extract,
        queryListings: (query) => queryListings(db, query),
      })

      expect(await service.planFill(QUERY)).toMatchObject({
        listings: 1,
        documents: 0,
        cachedDocuments: 1,
      })
      await service.fill(QUERY)
      await service.idle()

      expect(fetch).not.toHaveBeenCalled()
      expect(extract).not.toHaveBeenCalled()
      const estimates = db.select().from(areaEstimates).all()
      if (sqm === null) expect(estimates).toEqual([])
      else expect(estimates).toMatchObject([{ documentSha256: 'sha', sqm }])
      expect(queryListings(db, QUERY).rows[0]?.area?.sqm ?? null).toBe(sqm)
      expect(await service.planFill(QUERY)).toMatchObject({ documents: 0, cachedDocuments: 0 })
      await service.fill(QUERY)
      await service.idle()
      expect(replace).toHaveBeenCalledTimes(1)
    },
  )

  it('extracts changed downloaded bytes after an interrupted read instead of reusing old pages', async () => {
    const edict = edictId(202)
    insertEdict(db, edict)
    const documentId = insertGutachten(db, edict)
    await storeReadDocument(db, documentsDir, documentId, edict, [
      { pageNumber: 1, printedLabel: null, hasText: true, text: 'Old report pages' },
    ])
    const store = createDocumentStore(db)
    const oldPath = store.find(documentId)?.row.localPath
    expect(oldPath).toBeTruthy()
    await rm(path.join(documentsDir, oldPath ?? 'missing'))
    const extract = vi
      .fn<DocumentServiceDeps['extract']>()
      .mockRejectedValueOnce(new AppError('cancelled', 'Interrupted after download'))
      .mockResolvedValueOnce(AREA_DOCUMENT)
    const fetch = vi.fn(pdfFetch)
    const { service } = setup([], { extract, fetch })

    await expect(service.prepare(documentId, new AbortController().signal)).rejects.toMatchObject({
      code: 'cancelled',
    })
    await service.idle()
    await service.prepare(documentId, new AbortController().signal)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(extract).toHaveBeenCalledTimes(2)
    expect(store.pageTexts(documentId).map((page) => page.text)).toEqual(
      AREA_DOCUMENT.pages.map((page) => page.text),
    )
  })

  it('retains extraction on an identical re-download and re-reads a cache with unknown identity', async () => {
    const edict = edictId(204)
    insertEdict(db, edict)
    const documentId = insertGutachten(db, edict)
    await storeReadDocument(db, documentsDir, documentId, edict, AREA_DOCUMENT.pages)
    const store = createDocumentStore(db)
    const row = store.find(documentId)?.row
    expect(row).toBeDefined()
    store.recordDownload(documentId, {
      localPath: row?.localPath ?? '',
      sha256: 'sha',
      bytes: 17,
      downloadedAt: '2026-11-06T08:00:00.000Z',
    })
    expect(store.find(documentId)?.row.extractedAt).toBe(NOW)
    expect(store.pageTexts(documentId)).toHaveLength(2)
    const extract = vi.fn<DocumentServiceDeps['extract']>().mockResolvedValue(AREA_DOCUMENT)
    const fetch = vi.fn<DocumentServiceDeps['fetch']>()
    const { service } = setup([], { extract, fetch })

    await service.prepare(documentId, new AbortController().signal)
    expect(extract).not.toHaveBeenCalled()
    db.update(documents).set({ sha256: null }).where(eq(documents.id, documentId)).run()

    const prepared = await service.prepare(documentId, new AbortController().signal)

    expect(prepared.row.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(extract).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('finishes an interrupted cached extraction even without an old estimate row', async () => {
    const edict = edictId(205)
    insertEdict(db, edict, { bundesland: 'wien' })
    const documentId = insertGutachten(db, edict)
    await storeReadDocument(db, documentsDir, documentId, edict, [])
    db.update(documents)
      .set({ extractedAt: null, pageCount: null })
      .where(eq(documents.id, documentId))
      .run()
    const fetch = vi.fn<DocumentServiceDeps['fetch']>()
    const extract = vi.fn<DocumentServiceDeps['extract']>().mockResolvedValue(AREA_DOCUMENT)
    const { service } = setup([], {
      fetch,
      extract,
      queryListings: (query) => queryListings(db, query),
    })

    expect(await service.planFill(QUERY)).toMatchObject({ documents: 0, cachedDocuments: 1 })
    await service.fill(QUERY)
    await service.idle()

    expect(queryListings(db, QUERY).rows[0]?.area?.sqm).toBe(70)
    expect(extract).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('downloads a document, reads it and stores the local estimate', async () => {
    const edict = edictId(1)
    insertEdict(db, edict)
    const documentId = insertGutachten(db, edict)
    const { service, events, progress } = setup()

    const info = await service.download({ documentId })

    expect(info).toMatchObject({ downloaded: true, pageCount: 2, scannedPages: [2] })
    expect(db.select().from(areaEstimates).all()).toMatchObject([{ documentId, sqm: 70 }])
    expect(progress().at(-1)).toMatchObject({ job: 'single', phase: 'done', done: 1, total: 1 })
    expect(events).toContainEqual({ event: 'listings:changed', payload: { edictIds: [edict] } })
  })

  it('opens a document at a page after downloading it', async () => {
    const edict = edictId(2)
    insertEdict(db, edict)
    const documentId = insertGutachten(db, edict)
    const { service, opened } = setup()

    await service.open({ documentId, page: 4 })

    const localPath = createDocumentStore(db).find(documentId)?.row.localPath
    expect(localPath).toMatch(new RegExp(`^${edict}/`))
    expect(opened).toEqual([{ documentsDir, localPath, page: 4, title: 'Eigentumswohnung Top 3' }])
  })

  it('plans a fill from the listings without an area', async () => {
    const toDownload = edictId(3)
    const downloaded = edictId(4)
    const withoutDocument = edictId(5)
    const withArea = edictId(6)
    for (const id of [toDownload, downloaded, withoutDocument, withArea]) insertEdict(db, id)
    insertGutachten(db, toDownload, { statedSizeKb: 300 })
    await storeReadDocument(db, documentsDir, insertGutachten(db, downloaded), downloaded, [])
    insertGutachten(db, withArea)
    const rows = [
      listingRow(toDownload, null),
      listingRow(downloaded, null),
      listingRow(withoutDocument, null),
      listingRow(withArea, 64),
    ]
    const { service, queries } = setup(rows)

    expect(await service.planFill({ ...QUERY, includeWithoutArea: false })).toEqual({
      listings: 3,
      documents: 1,
      cachedDocuments: 0,
      totalKb: 300,
    })
    expect(queries[0]?.includeWithoutArea).toBe(true)
  })

  it('runs one fill at a time and stops when cancelled', async () => {
    const edict = edictId(7)
    insertEdict(db, edict)
    insertGutachten(db, edict)
    const { service, progress } = setup([listingRow(edict, null)], { fetch: hangingFetch })

    expect(await service.fill(QUERY)).toEqual({
      listings: 1,
      documents: 1,
      cachedDocuments: 0,
      totalKb: 100,
    })
    await expect(service.fill(QUERY)).rejects.toMatchObject({ code: 'busy' })
    service.cancelFill()
    await service.idle()

    expect(progress().at(-1)).toMatchObject({ job: 'fill', phase: 'cancelled' })
  })

  it('deletes the files of cases closed longer than the retention period', async () => {
    const closed = edictId(8)
    const open = edictId(9)
    const starred = edictId(10)
    insertEdict(db, closed, { status: 'sold', publishedAt: '2026-09-01' })
    insertEdict(db, open)
    insertEdict(db, starred, { status: 'sold', publishedAt: '2026-09-01' })
    db.insert(userState)
      .values({ caseKey: `case-${starred}`, starred: true, updatedAt: NOW })
      .run()
    const documentIds: number[] = []
    for (const id of [closed, open, starred]) {
      const documentId = insertGutachten(db, id)
      const page = { pageNumber: 1, printedLabel: null, hasText: true, text: 'Seite 1' }
      await storeReadDocument(db, documentsDir, documentId, id, [page])
      documentIds.push(documentId)
    }
    const { service, events } = setup()

    expect(await service.runRetention()).toEqual({ deleted: 1, missing: 0, refused: 0 })

    const store = createDocumentStore(db)
    expect(documentIds.map((id) => store.find(id)?.info.downloaded)).toEqual([false, true, true])
    expect(store.pageTexts(documentIds[0] ?? -1)).toEqual([])
    expect(events).toContainEqual({ event: 'listings:changed', payload: { edictIds: [closed] } })
  })
})

describe('shared downloads', () => {
  it('lets one caller cancel while the download goes on for the others', async () => {
    const edict = edictId(11)
    insertEdict(db, edict)
    const documentId = insertGutachten(db, edict)
    const gated = gatedFetch()
    const { service, progress } = setup([], { fetch: gated.fetch })
    const job = new AbortController()
    const jobSteps: string[] = []

    const prepared = service.prepare(documentId, job.signal, (step) => jobSteps.push(step))
    await vi.waitFor(() => expect(gated.signals).toHaveLength(1))
    const download = service.download({ documentId })
    // A caller that joins gets the current step first: the download has joined.
    await vi.waitFor(() => expect(progress()).toHaveLength(1))
    job.abort()
    await expect(prepared).rejects.toMatchObject({ code: 'cancelled' })
    gated.release()

    await expect(download).resolves.toMatchObject({ downloaded: true, pageCount: 2 })
    expect(gated.signals).toHaveLength(1)
    expect(jobSteps).toEqual(['download'])
    const phases = progress().map((event) => event.phase)
    expect(phases).toContain('extract')
    expect(phases).not.toContain('cancelled')
    expect(phases.at(-1)).toBe('done')
  })

  it('stops waiting at once on cancel, and stops the download once nobody waits', async () => {
    const shared = edictId(12)
    const alone = edictId(13)
    for (const id of [shared, alone]) insertEdict(db, id)
    const sharedId = insertGutachten(db, shared)
    const aloneId = insertGutachten(db, alone)
    const gated = gatedFetch()
    const { service, progress } = setup([], { fetch: gated.fetch })

    const single = service.download({ documentId: sharedId })
    await vi.waitFor(() => expect(gated.signals).toHaveLength(1))
    const job = new AbortController()
    const joined = service.prepare(sharedId, job.signal)
    job.abort()
    await expect(joined).rejects.toMatchObject({ code: 'cancelled' })
    expect(gated.signals[0]?.aborted).toBe(false)

    const lone = new AbortController()
    const prepared = service.prepare(aloneId, lone.signal)
    await vi.waitFor(() => expect(gated.signals).toHaveLength(2))
    lone.abort()
    await expect(prepared).rejects.toMatchObject({ code: 'cancelled' })
    expect(gated.signals[1]?.aborted).toBe(true)

    service.shutdown()
    await expect(single).rejects.toMatchObject({ code: 'cancelled' })
    await service.idle()
    expect(progress().at(-1)).toMatchObject({ job: 'single', phase: 'cancelled' })
    await expect(service.download({ documentId: aloneId })).rejects.toMatchObject({
      code: 'cancelled',
    })
  })

  it('downloads a document once for a fill and a single download, and a cancelled fill leaves the download running', async () => {
    const edict = edictId(14)
    insertEdict(db, edict)
    const documentId = insertGutachten(db, edict)
    const gated = gatedFetch()
    const { service, progress } = setup([listingRow(edict, null)], { fetch: gated.fetch })

    await service.fill(QUERY)
    await vi.waitFor(() => expect(gated.signals).toHaveLength(1))
    const single = service.download({ documentId })
    const joined = () => progress().filter((event) => event.job === 'single')
    await vi.waitFor(() => expect(joined()).toHaveLength(1))
    service.cancelFill()
    gated.release()

    await expect(single).resolves.toMatchObject({ downloaded: true })
    await service.idle()
    expect(gated.signals).toHaveLength(1)
    const fill = progress().filter((event) => event.job === 'fill')
    expect(fill.at(-1)).toMatchObject({ phase: 'cancelled' })
  })
})

describe('EdikteClient.limitedFetch', () => {
  it('holds page requests until a download body has been read', async () => {
    const requested: string[] = []
    const pdf = new TransformStream<Uint8Array, Uint8Array>()
    const client = new EdikteClient({
      appVersion: 'test',
      minIntervalMs: 0,
      fetch: (input) => {
        const url = input instanceof Request ? input.url : input.toString()
        requested.push(url)
        if (url.endsWith('.pdf')) return Promise.resolve(new Response(pdf.readable))
        return Promise.resolve(
          new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
        )
      },
    })

    const download = await client.limitedFetch('https://edikte.justiz.gv.at/edikte/ex/a.pdf')
    const page = client.getText('https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/suche?OpenForm')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requested).toHaveLength(1)

    const writer = pdf.writable.getWriter()
    void writer.write(new TextEncoder().encode('%PDF-'))
    void writer.close()
    expect(await download.text()).toBe('%PDF-')
    await page
    expect(requested).toHaveLength(2)
  })
})
