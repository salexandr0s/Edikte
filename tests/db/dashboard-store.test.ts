import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import type { CollectionSection } from '@shared/notifications'
import { openDatabase, type AppDatabase } from '../../src/main/db/client'
import { queryListingCollection } from '../../src/main/db/collection-store'
import { getDashboard } from '../../src/main/db/dashboard-store'
import { moveDiscoveryCase, seedDiscoveryBaseline } from '../../src/main/db/discovery-store'
import { listingDiscoveries } from '../../src/main/db/schema'
import { saveFilter, updateUserState } from '../../src/main/db/user-store'
import { edictId, insertEdict } from './listing-fixtures'

const NOW = new Date('2026-11-11T08:30:00.000Z')
const databases: AppDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) db.$client.close()
})

function fixture() {
  const db = openDatabase(':memory:')
  databases.push(db)
  insertEdict(db, 1, { objektgroesseSqm: 50, auctionAt: '2026-11-12T10:00' })
  insertEdict(db, 2, {
    objektgroesseSqm: 50,
    schaetzwertEur: 300_000,
    auctionAt: '2026-11-20T10:00',
  })
  insertEdict(db, 3, {
    objektgroesseSqm: 60,
    propertyType: 'house',
    schaetzwertEur: 180_000,
    auctionAt: '2026-11-30T10:00',
  })
  insertEdict(db, 4, { objektgroesseSqm: 50, auctionAt: '2026-11-12T10:00' })
  insertEdict(db, 5, {
    id: 'mv-5',
    caseKey: 'insolvency:5',
    source: 'insolvency_sale',
    status: 'on_offer',
    objektgroesseSqm: 40,
    schaetzwertEur: 120_000,
    geringstesGebotEur: null,
    auctionAt: null,
  })
  insertEdict(db, 6, { bundesland: 'noe', objektgroesseSqm: 50 })
  insertEdict(db, 7, { objektgroesseSqm: 50, auctionAt: '2026-11-11T09:00' })
  updateUserState(db, { caseKey: 'case-4', hidden: true })
  updateUserState(db, { caseKey: 'case-2', starred: true })
  updateUserState(db, { caseKey: 'case-3', starred: true })
  seedDiscoveryBaseline(db, new Date('2026-11-01T08:00:00.000Z'))
  for (const [caseKey, committedAt] of [
    ['case-2', '2026-11-11T08:00:00.000Z'],
    ['case-3', '2026-11-02T08:00:00.000Z'],
    ['case-4', '2026-11-11T08:00:00.000Z'],
    ['insolvency:5', '2026-11-10T11:00:00.000Z'],
    ['case-7', '2026-11-10T09:00:00.000Z'],
  ]) {
    db.update(listingDiscoveries)
      .set({ kind: 'live', committedAt })
      .where(eq(listingDiscoveries.caseKey, caseKey!))
      .run()
  }
  const appraised = saveFilter(db, { name: 'Appraised under 5k', query: { maxPricePerSqm: 5000 } })
  const bid = saveFilter(db, {
    name: 'Apartments under 2.5k minimum bid',
    query: {
      sources: ['court_auction'],
      propertyTypes: ['apartment'],
      priceBasis: 'geringstes_gebot',
      maxPricePerSqm: 2500,
    },
  })
  const outside = saveFilter(db, { name: 'Outside synced area', query: { bundeslaender: ['noe'] } })
  return { db, appraised, bid, outside }
}

describe('dashboard collections', () => {
  it('deduplicates saved-search unions while respecting each price basis and section', () => {
    const { db, appraised, bid, outside } = fixture()
    const dashboard = getDashboard(db, { filterId: null }, NOW)
    expect(dashboard.counts).toEqual({ matching: 5, new: 3, upcoming: 2, starred: 2 })
    expect(dashboard.newListings.map((item) => item.listing.id)).toEqual([
      edictId(2),
      'mv-5',
      edictId(7),
    ])
    expect(dashboard.searches.find((search) => search.filter.id === appraised.id)?.matchCount).toBe(
      4,
    )
    expect(dashboard.searches.find((search) => search.filter.id === bid.id)?.matchCount).toBe(3)
    expect(dashboard.searches.find((search) => search.filter.id === outside.id)).toMatchObject({
      inScope: false,
      matchCount: 0,
    })
    for (const section of ['all', 'new', 'upcoming', 'starred'] satisfies CollectionSection[]) {
      const collection = queryListingCollection(
        db,
        { kind: 'saved_searches', filterId: null, section },
        NOW,
      )
      expect(collection.total).toBe(dashboard.counts[section === 'all' ? 'matching' : section])
      expect(new Set(collection.items.map((item) => item.listing.caseKey)).size).toBe(
        collection.total,
      )
    }
    const all = queryListingCollection(
      db,
      { kind: 'saved_searches', filterId: null, section: 'all' },
      NOW,
    )
    expect(all.items.find((item) => item.listing.id === edictId(1))?.filterIds).toEqual([
      appraised.id,
      bid.id,
    ])
    const selected = getDashboard(db, { filterId: bid.id }, NOW)
    expect(selected.counts).toEqual({ matching: 3, new: 2, upcoming: 2, starred: 1 })
    expect(
      selected.newListings.every((item) => item.listing.priceBasis === 'geringstes_gebot'),
    ).toBe(true)
  })

  it('counts a corrected case once in each search and preserves every matching search in the union', () => {
    const { db, appraised, bid } = fixture()
    moveDiscoveryCase(db, 'case-1', 'case-2')
    const dashboard = getDashboard(db, { filterId: null }, NOW)
    expect(dashboard.counts).toMatchObject({ matching: 4, new: 2 })
    expect(dashboard.searches.find(({ filter }) => filter.id === bid.id)).toMatchObject({
      matchCount: 2,
      newCount: 1,
    })
    const union = queryListingCollection(
      db,
      { kind: 'saved_searches', filterId: null, section: 'all' },
      NOW,
    )
    const merged = union.items.find(({ listing }) => listing.caseKey === 'case-1')
    expect(merged?.filterIds).toEqual([appraised.id, bid.id])
    const selected = queryListingCollection(
      db,
      { kind: 'saved_searches', filterId: bid.id, section: 'all' },
      NOW,
    )
    expect(
      selected.items.every(({ filterIds }) => filterIds.length === 1 && filterIds[0] === bid.id),
    ).toBe(true)
  })

  it('uses Vienna wall time at both boundaries of the upcoming window across the clock change', () => {
    const db = openDatabase(':memory:')
    databases.push(db)
    insertEdict(db, 1, { auctionAt: '2026-10-24T01:29' })
    insertEdict(db, 2, { auctionAt: '2026-10-24T01:30' })
    insertEdict(db, 3, { auctionAt: '2026-11-07T01:29' })
    insertEdict(db, 4, { auctionAt: '2026-11-07T01:30' })
    const filter = saveFilter(db, { name: 'All auctions', query: {} })
    const selected = getDashboard(db, { filterId: filter.id }, new Date('2026-10-23T23:30:00Z'))
    expect(selected.upcomingListings.map(({ listing }) => listing.id)).toEqual([
      edictId(2),
      edictId(3),
    ])
  })

  it('keeps empty saved searches empty and rejects a deleted selection', () => {
    const db = openDatabase(':memory:')
    databases.push(db)
    const dashboard = getDashboard(db, { filterId: null }, NOW)
    expect(dashboard.counts).toEqual({ matching: 0, new: 0, upcoming: 0, starred: 0 })
    expect(dashboard.searches).toEqual([])
    expect(dashboard.trackingStartedAt).toBeNull()
    expect(() => getDashboard(db, { filterId: 99 }, NOW)).toThrow('does not exist')
  })
})
