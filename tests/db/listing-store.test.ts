import { afterEach, describe, expect, it } from 'vitest'
import { ListingQuerySchema, PRESET_WIEN_UNDER_5000, type ListingRow } from '@shared/domain'
import { isAppError } from '@shared/errors'
import { openDatabase, type AppDatabase } from '../../src/main/db/client'
import { getListing, queryListings } from '../../src/main/db/listing-store'
import { documentPages } from '../../src/main/db/schema'
import { updateSettings } from '../../src/main/db/settings-store'
import { updateUserState } from '../../src/main/db/user-store'
import {
  T0,
  analysisResult,
  edictId,
  insertAnalysis,
  insertDocument,
  insertEdict,
  insertEstimate,
  risk,
} from './listing-fixtures'

let db: AppDatabase | null = null

function open(): AppDatabase {
  db = openDatabase(':memory:')
  return db
}

afterEach(() => {
  db?.$client.close()
  db = null
})

function rowsById(database: AppDatabase): Map<string, ListingRow> {
  const page = queryListings(database, ListingQuerySchema.parse({}))
  return new Map(page.rows.map((row) => [row.id, row]))
}

function errorCode(run: () => unknown): string | null {
  try {
    run()
  } catch (error) {
    return isAppError(error) ? error.code : 'other'
  }
  return null
}

describe('listing rows', () => {
  it('take the area from the edict, then the latest finished analysis, then local estimates', () => {
    const database = open()
    const verified = [{ path: 'areas.0', page: 3, status: 'verified' as const }]
    // The Objektgröße wins; the analysis differs from it by more than 10 %.
    insertEdict(database, 1, { objektgroesseSqm: 50 })
    insertAnalysis(database, edictId(1), {
      status: 'done',
      result: analysisResult(),
      evidence: verified,
    })
    // A verified AI area; the risk comes from the finished run, the status from a newer one.
    insertEdict(database, 2)
    const gutachten = insertDocument(database, edictId(2))
    insertAnalysis(database, edictId(2), {
      status: 'done',
      result: analysisResult({ risks: [risk('medium'), risk('high')] }),
      evidence: verified,
      documentIds: [gutachten],
    })
    insertAnalysis(database, edictId(2), { status: 'running' })
    // The evidence check did not find the quote.
    insertEdict(database, 3)
    insertAnalysis(database, edictId(3), {
      status: 'done',
      result: analysisResult(),
      evidence: [{ path: 'areas.0', page: 3, status: 'quote_not_found' }],
    })
    insertEdict(database, 4)
    insertEstimate(database, edictId(4), insertDocument(database, edictId(4)), 40)
    insertEdict(database, 5, {
      propertyType: 'land',
      grundstuecksgroesseSqm: 600,
      schaetzwertEur: 900_000,
    })
    // A stored result that fails the schema gives neither area nor risk.
    insertEdict(database, 6)
    insertAnalysis(database, edictId(6), { status: 'done', result: { areas: 'broken' } })

    const rows = rowsById(database)
    expect(rows.get(edictId(1))).toMatchObject({
      area: { source: 'listing', kind: 'nutzflaeche', sqm: 50 },
      pricePerSqm: 4000,
      approximate: ['area_mismatch'],
      analysisStatus: 'done',
    })
    expect(rows.get(edictId(2))).toMatchObject({
      area: { source: 'ai_verified', sqm: 60, page: 3, documentId: gutachten },
      analysisStatus: 'running',
      hasAnalysis: true,
      riskLevel: 'high',
      hasLanggutachten: true,
    })
    expect(rows.get(edictId(3))?.area?.source).toBe('ai_unverified')
    expect(rows.get(edictId(4))).toMatchObject({
      area: { source: 'local_estimate', sqm: 40 },
      pricePerSqm: 5000,
      analysisStatus: null,
    })
    expect(rows.get(edictId(5))).toMatchObject({
      area: { source: 'listing', kind: 'grundflaeche', sqm: 600 },
      plotSqm: 600,
      pricePerSqm: 1500,
    })
    expect(rows.get(edictId(6))).toMatchObject({
      area: null,
      riskLevel: null,
      analysisStatus: 'done',
    })
  })

  it('apply the "Wien unter 5.000 €/m²" preset within the synced scope', () => {
    const database = open()
    updateSettings(database, { syncBundeslaender: ['wien', 'noe'] })
    insertEdict(database, 1, { objektgroesseSqm: 50 }) // 4,000 €/m²
    insertEdict(database, 2, { objektgroesseSqm: 40, schaetzwertEur: 240_000 }) // 6,000 €/m²
    insertEdict(database, 3, {
      propertyType: 'house',
      objektgroesseSqm: 100,
      schaetzwertEur: 450_000,
    }) // 4,500 €/m²
    insertEdict(database, 4) // no area
    insertEdict(database, 5, { bundesland: 'noe', objektgroesseSqm: 50, schaetzwertEur: 100_000 })
    insertEdict(database, 6, {
      propertyType: 'land',
      grundstuecksgroesseSqm: 600,
      schaetzwertEur: 900_000,
    })
    insertEdict(database, 7, { objektgroesseSqm: 50, schaetzwertEur: 100_000, removedAt: T0 })
    insertEdict(database, 8, { bundesland: 'tirol', objektgroesseSqm: 50, schaetzwertEur: 100_000 })

    const page = queryListings(database, ListingQuerySchema.parse(PRESET_WIEN_UNDER_5000))
    expect(page.rows.map((row) => [row.id, row.pricePerSqm])).toEqual([
      [edictId(1), 4000],
      [edictId(3), 4500],
    ])
    // Wien and NÖ without the removed edict.
    expect(page.totalInScope).toBe(6)
    expect(getListing(database, edictId(7)).removedAt).toBe(T0)
  })
})

describe('listing cases', () => {
  it('show a sold flat once, with the status of its newest final notice', () => {
    const database = open()
    // The auction, the sale without a higher bid and the distribution of the proceeds.
    insertEdict(database, 1, {
      caseKey: 'case-a',
      objektgroesseSqm: 50,
      publishedAt: '2026-08-10',
      auctionAt: '2026-09-24T10:00',
    })
    insertEdict(database, 2, {
      caseKey: 'case-a',
      noticeType: 'zuschlag_ohne_ueberbot',
      status: 'sold',
      publishedAt: '2026-09-30',
      schaetzwertEur: null,
    })
    insertEdict(database, 3, {
      caseKey: 'case-a',
      noticeType: 'meistbotsverteilung',
      status: 'closed',
      publishedAt: '2026-10-28',
      schaetzwertEur: null,
    })
    insertDocument(database, edictId(1))
    insertEdict(database, 4)

    const upcoming = queryListings(database, ListingQuerySchema.parse({}))
    expect(upcoming.rows.map((row) => row.id)).toEqual([edictId(4)])
    expect(upcoming.totalInScope).toBe(2)
    const all = queryListings(
      database,
      ListingQuerySchema.parse({ statuses: ['upcoming', 'postponed', 'sold', 'closed'] }),
    )
    expect(all.rows.filter((row) => row.caseKey === 'case-a')).toEqual([
      expect.objectContaining({
        id: edictId(1),
        status: 'closed',
        noticeType: 'meistbotsverteilung',
        auctionAt: '2026-09-24T10:00',
        pricePerSqm: 4000,
        hasLanggutachten: true,
      }),
    ])
    // The other notices still open, with the rest of the case as related edicts.
    expect(getListing(database, edictId(2)).related.map((related) => related.id)).toEqual([
      edictId(1),
      edictId(3),
    ])
  })

  it('follow a re-scheduled auction to its newest notice', () => {
    const database = open()
    // Versteigerung, Verschiebung, then a new Versteigerung with a lower Schätzwert.
    insertEdict(database, 1, {
      caseKey: 'case-b',
      publishedAt: '2026-08-03',
      auctionAt: '2026-09-15T10:00',
    })
    insertEdict(database, 2, {
      caseKey: 'case-b',
      noticeType: 'verschiebung',
      status: 'postponed',
      publishedAt: '2026-09-02',
      auctionAt: '2026-09-15T10:00',
    })
    insertEdict(database, 3, {
      caseKey: 'case-b',
      publishedAt: '2026-10-06',
      auctionAt: '2026-11-24T09:30',
      schaetzwertEur: 180_000,
    })
    // Sold, then put up for auction again (Wiederversteigerung).
    insertEdict(database, 4, { caseKey: 'case-c', publishedAt: '2026-07-01' })
    insertEdict(database, 5, {
      caseKey: 'case-c',
      noticeType: 'zuschlag_mit_ueberbot',
      status: 'sold',
      publishedAt: '2026-08-20',
    })
    insertEdict(database, 6, { caseKey: 'case-c', publishedAt: '2026-10-15' })

    const page = queryListings(database, ListingQuerySchema.parse({}))
    const byCase = new Map(page.rows.map((row) => [row.caseKey, row]))
    expect(page.rows).toHaveLength(2)
    expect(page.totalInScope).toBe(2)
    expect(byCase.get('case-b')).toMatchObject({
      id: edictId(3),
      status: 'upcoming',
      noticeType: 'versteigerung',
      auctionAt: '2026-11-24T09:30',
      schaetzwertEur: 180_000,
    })
    expect(byCase.get('case-c')).toMatchObject({ id: edictId(6), status: 'upcoming' })
  })

  it('report the case status in the detail of the Versteigerung of a sold case', () => {
    const database = open()
    insertEdict(database, 1, {
      caseKey: 'case-a',
      publishedAt: '2026-08-10',
      auctionAt: '2026-09-24T10:00',
    })
    insertEdict(database, 2, {
      caseKey: 'case-a',
      noticeType: 'zuschlag_mit_ueberbot',
      status: 'sold',
      publishedAt: '2026-09-30',
      schaetzwertEur: null,
      meistbotEur: 231_000,
    })

    // Status and Meistbot come from the sale; the other numbers stay the opened edict's.
    expect(getListing(database, edictId(1))).toMatchObject({
      id: edictId(1),
      status: 'sold',
      noticeType: 'zuschlag_mit_ueberbot',
      schaetzwertEur: 200_000,
      meistbotEur: 231_000,
      auctionAt: '2026-09-24T10:00',
      related: [expect.objectContaining({ id: edictId(2), status: 'sold' })],
    })
  })
})

describe('listing detail', () => {
  it('collects documents, estimates, the latest analysis, user state and related edicts', () => {
    const database = open()
    insertEdict(database, 1, {
      caseKey: 'case-a',
      noticeType: 'verschiebung',
      status: 'postponed',
      relatedIds: [edictId(2), edictId(9)],
    })
    insertEdict(database, 2, { caseKey: 'case-old', publishedAt: '2026-08-20' })
    insertEdict(database, 3, { caseKey: 'case-a', publishedAt: '2026-09-01' })
    insertEdict(database, 4)
    const gutachten = insertDocument(database, edictId(1), {
      pageCount: 2,
      localPath: `${edictId(1)}/gutachten.pdf`,
      downloadedAt: T0,
    })
    database
      .insert(documentPages)
      .values([
        { documentId: gutachten, pageNumber: 1, hasText: true, text: 'Befund' },
        { documentId: gutachten, pageNumber: 2, hasText: false, text: '' },
      ])
      .run()
    insertEstimate(database, edictId(1), gutachten, 55)
    insertAnalysis(database, edictId(1), { status: 'failed' })
    updateUserState(database, { caseKey: 'case-a', starred: true, notes: 'Besichtigung anfragen' })

    const detail = getListing(database, edictId(1))
    expect(detail).toMatchObject({
      starred: true,
      notes: 'Besichtigung anfragen',
      area: { source: 'local_estimate', sqm: 55 },
      analysis: { status: 'failed', result: null },
      analysisStatus: 'failed',
    })
    expect(detail.documents).toEqual([
      expect.objectContaining({ id: gutachten, downloaded: true, scannedPages: [2] }),
    ])
    expect(detail.estimates).toEqual([expect.objectContaining({ documentId: gutachten, sqm: 55 })])
    expect(detail.areaCandidates.map((candidate) => candidate.source)).toEqual(['local_estimate'])
    // Edict 9 was never stored, so only stored edicts of the chain and the case appear.
    expect(detail.related.map((related) => related.id)).toEqual([edictId(2), edictId(3)])
    expect(errorCode(() => getListing(database, edictId(99)))).toBe('not_found')
  })
})
