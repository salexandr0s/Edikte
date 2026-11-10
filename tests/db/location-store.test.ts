import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/main/db/client'
import { loadPendingLocations } from '../../src/main/db/location-store'
import { T0, edictId, insertEdict } from './listing-fixtures'

let db: AppDatabase
beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => {
  db.$client.close()
})

it('looks up only enabled sources and active records, with dated auctions before undated sales', () => {
  insertEdict(db, 1)
  insertEdict(db, 2, {
    id: 'mv-990001',
    source: 'insolvency_sale',
    auctionAt: null,
    caseKey: 'insolvency:990001',
    status: 'on_offer',
    noticeType: 'insolvenzverkauf',
  })
  insertEdict(db, 3, { removedAt: T0 })
  insertEdict(db, 4, { bundesland: 'noe' })
  expect(loadPendingLocations(db, ['wien'], ['court_auction']).map((row) => row.edictId)).toEqual([
    edictId(1),
  ])
  expect(loadPendingLocations(db, ['wien'], ['insolvency_sale']).map((row) => row.edictId)).toEqual(
    ['mv-990001'],
  )
  expect(
    loadPendingLocations(db, ['wien'], ['court_auction', 'insolvency_sale']).map(
      (row) => row.edictId,
    ),
  ).toEqual([edictId(1), 'mv-990001'])
})
