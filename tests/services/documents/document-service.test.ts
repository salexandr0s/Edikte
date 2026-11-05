import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DocumentProgressSchema,
  ListingQuerySchema,
  type ListingQuery,
  type ListingRow,
} from '@shared/domain'
import { openDatabase, type AppDatabase } from '../../../src/main/db/client'
import { createDocumentStore } from '../../../src/main/db/document-store'
import { areaEstimates, userState } from '../../../src/main/db/schema'
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
      totalKb: 300,
    })
    expect(queries[0]?.includeWithoutArea).toBe(true)
  })

  it('runs one fill at a time and stops when cancelled', async () => {
    const edict = edictId(7)
    insertEdict(db, edict)
    insertGutachten(db, edict)
    const { service, progress } = setup([listingRow(edict, null)], { fetch: hangingFetch })

    expect(await service.fill(QUERY)).toEqual({ listings: 1, documents: 1, totalKb: 100 })
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
