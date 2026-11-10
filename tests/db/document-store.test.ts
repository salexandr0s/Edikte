import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/main/db/client'
import { createDocumentStore } from '../../src/main/db/document-store'
import { edicts, userState } from '../../src/main/db/schema'
import { NOW, edictId, insertEdict, insertGutachten } from '../services/documents/seed'

let db: AppDatabase

beforeEach(() => {
  db = openDatabase(':memory:')
})

afterEach(() => {
  db.$client.close()
})

describe('document store', () => {
  it('selects the first published report and keeps an on-offer sale open until removal', () => {
    const id = 'mv-990001'
    insertEdict(db, id, {
      source: 'insolvency_sale',
      status: 'on_offer',
      publishedAt: '2026-01-01',
    })
    const retired = insertGutachten(db, id, {
      removedAt: NOW,
      localPath: `${id}/retired.pdf`,
    })
    const active = insertGutachten(db, id, { url: 'https://example.invalid/current.pdf' })
    insertGutachten(db, id, { url: 'https://example.invalid/second.pdf' })
    const store = createDocumentStore(db)
    expect(store.langgutachten([id]).get(id)?.id).toBe(active)
    expect(store.retentionCandidates()).toEqual([
      { documentId: retired, localPath: `${id}/retired.pdf`, caseClosedAt: null, keep: false },
    ])
    db.update(edicts).set({ removedAt: NOW }).where(eq(edicts.id, id)).run()
    expect(store.retentionCandidates()[0]?.caseClosedAt).toBe(NOW)
  })

  it('records a download with its pages and estimate, and forgets them again', () => {
    const edict = edictId(1)
    insertEdict(db, edict, {
      propertyType: 'house',
      title: 'Einfamilienhaus',
      schaetzwertEur: 300_000,
    })
    const documentId = insertGutachten(db, edict)
    insertGutachten(db, edict, { url: 'https://edikte.justiz.gv.at/edikte/ex/teil-2.pdf' })
    const store = createDocumentStore(db)

    store.recordDownload(documentId, {
      localPath: `${edict}/${documentId}-gutachten.pdf`,
      sha256: 'abc',
      bytes: 10,
      downloadedAt: NOW,
    })
    store.recordPages(
      documentId,
      { pageCount: 3, extractedAt: NOW, extractError: null },
      [3, 1, 2].map((pageNumber) => ({
        documentId,
        pageNumber,
        printedLabel: null,
        hasText: pageNumber !== 2,
        text: `Seite ${pageNumber}`,
      })),
    )
    store.replaceEstimates(documentId, [
      {
        edictId: edict,
        documentId,
        kind: 'wohnflaeche',
        sqm: 120,
        page: 1,
        quote: 'Wohnfläche 120 m²',
        confidence: 'medium',
        method: 'test',
        createdAt: NOW,
      },
    ])

    expect(store.find(documentId)).toMatchObject({
      edictTitle: 'Einfamilienhaus',
      facts: { propertyType: 'house', schaetzwertEur: 300_000 },
      info: { downloaded: true, pageCount: 3, scannedPages: [2] },
    })
    expect(store.pageTexts(documentId).map((page) => page.pageNumber)).toEqual([1, 2, 3])
    expect(store.langgutachten([edict, edictId(9)]).get(edict)?.id).toBe(documentId)
    expect(store.edictIdOf(documentId)).toBe(edict)

    expect(store.clearDownloads([documentId])).toEqual([edict])
    expect(store.find(documentId)?.info).toMatchObject({
      downloaded: false,
      pageCount: null,
      scannedPages: [],
    })
    expect(store.pageTexts(documentId)).toEqual([])
  })

  it('finds when each case closed and which cases the user keeps', () => {
    const sold = edictId(2)
    const notice = edictId(3)
    const upcoming = edictId(4)
    const removed = edictId(5)
    insertEdict(db, sold, {
      caseKey: 'case-a',
      status: 'sold',
      publishedAt: '2026-03-01',
      auctionAt: '2026-05-04T10:00',
    })
    insertEdict(db, notice, {
      caseKey: 'case-a',
      status: 'sold',
      noticeType: 'zuschlag_ohne_ueberbot',
      publishedAt: '2026-05-10',
    })
    insertEdict(db, upcoming, { caseKey: 'case-b' })
    insertEdict(db, removed, { caseKey: 'case-c', removedAt: '2026-06-01T12:00:00.000Z' })
    db.insert(userState).values({ caseKey: 'case-c', starred: true, updatedAt: NOW }).run()
    const store = createDocumentStore(db)
    for (const id of [sold, upcoming, removed]) {
      const documentId = insertGutachten(db, id)
      store.recordDownload(documentId, {
        localPath: `${id}/${documentId}-gutachten.pdf`,
        sha256: 'abc',
        bytes: 10,
        downloadedAt: NOW,
      })
    }
    // Never downloaded, so nothing to delete.
    insertGutachten(db, notice)

    expect(
      store.retentionCandidates().map(({ caseClosedAt, keep }) => ({ caseClosedAt, keep })),
    ).toEqual([
      { caseClosedAt: '2026-05-10', keep: false },
      { caseClosedAt: null, keep: false },
      { caseClosedAt: '2026-06-01T12:00:00.000Z', keep: true },
    ])
  })
})
