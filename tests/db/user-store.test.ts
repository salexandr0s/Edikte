import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ListingQuerySchema, PRESET_WIEN_UNDER_5000 } from '@shared/domain'
import { openDatabase, type AppDatabase } from '../../src/main/db/client'
import { savedFilters } from '../../src/main/db/schema'
import { ensurePresetFilters, listSavedFilters, saveFilter } from '../../src/main/db/user-store'
import { T0 } from './listing-fixtures'

let db: AppDatabase
beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => {
  db.$client.close()
})

it('keeps legacy saved filters on auctions while presets and new filters cover both sources', () => {
  db.insert(savedFilters)
    .values([
      { name: 'Alt', query: { bezirke: [3] }, createdAt: T0, updatedAt: T0 },
      {
        name: 'Alte Vorgabe',
        query: { sources: ['court_auction'] },
        presetKey: 'wien_under_5000',
        createdAt: T0,
        updatedAt: T0,
      },
    ])
    .run()
  const before = listSavedFilters(db)
  expect(before[0]?.query.sources).toEqual(['court_auction'])
  const presetId = before[1]?.id
  ensurePresetFilters(db)
  ensurePresetFilters(db)
  const [legacy, preset] = listSavedFilters(db)
  expect(legacy?.query).toMatchObject({ sources: ['court_auction'], bezirke: [3] })
  expect(preset).toMatchObject({
    id: presetId,
    createdAt: T0,
    query: ListingQuerySchema.parse(PRESET_WIEN_UNDER_5000),
  })
  expect(saveFilter(db, { name: 'Neu', query: {} }).query.sources).toEqual([])
  if (legacy === undefined) throw new Error('Missing legacy fixture')
  saveFilter(db, { id: legacy.id, name: 'Neu gespeichert', query: { sources: [] } })
  expect(
    db.select().from(savedFilters).where(eq(savedFilters.id, legacy.id)).get()?.query.sources,
  ).toEqual([])
})
