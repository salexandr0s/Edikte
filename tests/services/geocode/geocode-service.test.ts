import { afterEach, describe, expect, it } from 'vitest'
import type { ListingLocation } from '@shared/domain'
import { AppError } from '@shared/errors'
import type { EventPayload } from '@shared/ipc'
import type { EventChannel } from '@shared/ipc-channels'
import { openDatabase, type AppDatabase } from '../../../src/main/db/client'
import { findLocationByKey, loadPendingLocations } from '../../../src/main/db/location-store'
import { queryListings } from '../../../src/main/db/listing-store'
import type { GeocodeQuery, Geocoder } from '../../../src/main/geocode'
import { createGeocodeService, GEOCODE_RETRY_MS } from '../../../src/main/services/geocode'
import { ListingQuerySchema } from '@shared/domain'
import { edictId, insertEdict } from '../../db/listing-fixtures'

// The service against an in-memory database and a scripted geocoder.

let db: AppDatabase | null = null

function open(): AppDatabase {
  db = openDatabase(':memory:')
  return db
}

afterEach(() => {
  db?.$client.close()
  db = null
})

type Event = { event: EventChannel; payload: unknown }

function scripted(
  answer: (query: GeocodeQuery) => ListingLocation | null | Error,
): Geocoder & { queries: GeocodeQuery[] } {
  const queries: GeocodeQuery[] = []
  return {
    queries,
    lookup: (query) => {
      queries.push(query)
      const result = answer(query)
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    },
  }
}

function harness(database: AppDatabase, geocoder: Geocoder, offline = false) {
  const events: Event[] = []
  let clock = Date.parse('2026-11-05T10:00:00.000Z')
  const service = createGeocodeService({
    db: database,
    geocoder,
    provider: 'test',
    emit: <E extends EventChannel>(event: E, payload: EventPayload<E>) => {
      events.push({ event, payload })
    },
    readSettings: () => ({ syncBundeslaender: ['wien'], syncSources: ['court_auction'] }),
    offline,
    now: () => clock,
  })
  return { service, events, advance: (ms: number) => (clock += ms) }
}

const here: ListingLocation = { lat: 48.2, lng: 16.4, precision: 'address' }

describe('createGeocodeService', () => {
  it('stores positions for the addresses in scope and tells the renderer', async () => {
    const database = open()
    insertEdict(database, 1, { street: 'Beispielgasse 12' })
    insertEdict(database, 2, { street: 'Musterstraße 3', plz: '1100' })
    // Out of scope: another state, and a removed notice.
    insertEdict(database, 3, { bundesland: 'noe' })
    insertEdict(database, 4, { removedAt: '2026-11-01T00:00:00.000Z' })
    const geocoder = scripted(() => here)
    const { service, events } = harness(database, geocoder)

    expect(service.run()).toEqual({ pending: 2, running: true })
    await service.idle()

    expect(geocoder.queries.map((query) => query.street)).toEqual([
      'Beispielgasse 12',
      'Musterstraße 3',
    ])
    const rows = queryListings(database, ListingQuerySchema.parse({})).rows
    expect(rows.find((row) => row.id === edictId(1))?.location).toEqual(here)
    expect(events.at(-2)).toEqual({
      event: 'listings:changed',
      payload: { edictIds: [edictId(1), edictId(2)] },
    })
    expect(events.at(-1)).toEqual({
      event: 'geocode:progress',
      payload: { pending: 0, running: false },
    })
  })

  it('asks once per address and remembers an address the service does not know', async () => {
    const database = open()
    insertEdict(database, 1, { street: 'Beispielgasse 12/3' })
    insertEdict(database, 2, { street: 'Beispielgasse 12/7', caseKey: 'case-2' })
    insertEdict(database, 3, { street: 'Nirgendwo 1' })
    const geocoder = scripted((query) => (query.street === 'Nirgendwo 1' ? null : here))
    const { service } = harness(database, geocoder)
    service.run()
    await service.idle()
    expect(geocoder.queries).toHaveLength(2)
    expect(findLocationByKey(database, 'nirgendwo 1|1030|wien')).toBeNull()
    expect(loadPendingLocations(database, ['wien'], ['court_auction'])).toEqual([])

    // A second run has nothing left to ask.
    expect(service.run()).toEqual({ pending: 0, running: false })
    await service.idle()
    expect(geocoder.queries).toHaveLength(2)
  })

  it('looks an edict up again once its address changed', async () => {
    const database = open()
    insertEdict(database, 1, { street: 'Beispielgasse 12' })
    const geocoder = scripted(() => here)
    const { service } = harness(database, geocoder)
    service.run()
    await service.idle()
    expect(loadPendingLocations(database, ['wien'], ['court_auction'])).toEqual([])
    database.$client
      .prepare('UPDATE edicts SET street = ? WHERE id = ?')
      .run('Andere Gasse 1', edictId(1))
    expect(loadPendingLocations(database, ['wien'], ['court_auction'])).toMatchObject([
      { edictId: edictId(1), query: { street: 'Andere Gasse 1' } },
    ])
  })

  it('stops at a failure and waits before asking again', async () => {
    const database = open()
    insertEdict(database, 1, { street: 'Beispielgasse 12' })
    insertEdict(database, 2, { street: 'Musterstraße 3' })
    const geocoder = scripted(() => new AppError('rate_limited', 'pause'))
    const { service, events, advance } = harness(database, geocoder)
    service.run()
    await service.idle()
    expect(geocoder.queries).toHaveLength(1)
    expect(events.at(-1)).toEqual({
      event: 'geocode:progress',
      payload: { pending: 2, running: false },
    })

    // Within the pause a run reports the count and asks nothing.
    expect(service.run()).toEqual({ pending: 2, running: false })
    await service.idle()
    expect(geocoder.queries).toHaveLength(1)

    advance(GEOCODE_RETRY_MS)
    expect(service.run()).toEqual({ pending: 2, running: true })
    await service.idle()
    expect(geocoder.queries).toHaveLength(2)
  })

  it('asks nothing offline', async () => {
    const database = open()
    insertEdict(database, 1)
    const geocoder = scripted(() => here)
    const { service } = harness(database, geocoder, true)
    expect(service.run()).toEqual({ pending: 1, running: false })
    await service.idle()
    expect(geocoder.queries).toEqual([])
  })
})
