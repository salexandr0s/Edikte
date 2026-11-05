import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListingQuerySchema, type Settings } from '@shared/domain'
import { isAppError } from '@shared/errors'
import { openDatabase, type AppDatabase } from '../../../src/main/db/client'
import { getListing, queryListings } from '../../../src/main/db/listing-store'
import { lastFinishedRun } from '../../../src/main/db/sync-store'
import type { EmitEvent } from '../../../src/main/ipc/events'
import {
  AUTO_SYNC_INTERVAL_MS,
  createSyncService,
  type SyncService,
} from '../../../src/main/services/sync'
import { FakeSite, idOf, sitePage } from './fake-site'

const HOUR = 60 * 60 * 1000

let opened: { db: AppDatabase; service: SyncService } | null = null

afterEach(async () => {
  if (opened === null) return
  await opened.service.dispose()
  opened.db.$client.close()
  opened = null
})

function setup() {
  const db = openDatabase(':memory:')
  const site = new FakeSite()
  site.pages = [sitePage(1), sitePage(2)]
  const settings: Pick<Settings, 'syncBundeslaender' | 'autoSync'> = {
    syncBundeslaender: ['wien'],
    autoSync: true,
  }
  const events: string[] = []
  const emit: EmitEvent = (event) => {
    events.push(event)
  }
  let time = Date.parse('2026-11-05T08:00:00.000Z')
  const service = createSyncService({
    db,
    source: site,
    emit,
    readSettings: () => settings,
    now: () => new Date(time),
  })
  opened = { db, service }
  const advance = (ms: number): void => {
    time += ms
  }
  return { db, site, settings, events, service, advance }
}

async function settled(service: SyncService): Promise<void> {
  await vi.waitFor(() => {
    expect(service.status().state).toBe('idle')
  })
}

function errorCode(run: () => unknown): string | null {
  try {
    run()
  } catch (error) {
    return isAppError(error) ? error.code : 'other'
  }
  return null
}

const reloads = (events: readonly string[]) =>
  events.filter((event) => event === 'listings:changed').length

describe('sync service', () => {
  it('stores a finished run and tells the renderer to reload', async () => {
    const { db, events, service } = setup()
    expect(service.start({ full: false }).state).toBe('running')
    await settled(service)

    expect(service.status().lastFinished).toMatchObject({ kind: 'full', status: 'ok', listed: 2 })
    const rows = queryListings(db, ListingQuerySchema.parse({})).rows
    expect(rows.map((row) => row.id).sort()).toEqual([idOf(1), idOf(2)])
    expect(getListing(db, idOf(1)).documents).toHaveLength(1)
    expect(events).toContain('sync:progress')
    expect(reloads(events)).toBe(1)
  })

  it('refuses a second start while busy and keeps the stored data when cancelled', async () => {
    const { db, site, events, service, advance } = setup()
    service.start({ full: false })
    await settled(service)
    const before = getListing(db, idOf(1)).title

    // Page 1 changes and is read; the run is cancelled while page 2 loads.
    site.pages = [sitePage(1, 'Wohnung Top 1 mit Kellerabteil'), sitePage(2)]
    site.hold = (url) => url.includes(idOf(2))
    advance(HOUR)
    service.start({ full: false })
    await vi.waitFor(() => {
      expect(site.waiting).toBe(1)
    })
    expect(errorCode(() => service.start({ full: true }))).toBe('busy')
    service.cancel()
    expect(service.status().state).toBe('cancelling')
    await settled(service)

    expect(service.status().lastFinished).toMatchObject({
      kind: 'incremental',
      status: 'cancelled',
    })
    expect(getListing(db, idOf(1)).title).toBe(before)
    expect(reloads(events)).toBe(1)

    site.release()
    service.start({ full: false })
    await settled(service)
    expect(getListing(db, idOf(1)).title).not.toBe(before)
    expect(reloads(events)).toBe(2)
  })

  it('starts on its own only when auto sync is on and a run is due', async () => {
    const { settings, service, advance } = setup()
    expect(service.startIfDue()).toBe(true)
    expect(service.startIfDue()).toBe(false)
    await settled(service)

    advance(HOUR)
    expect(service.startIfDue()).toBe(false)
    // A Bundesland added to the scope has never been synced.
    settings.syncBundeslaender = ['wien', 'noe']
    expect(service.startIfDue()).toBe(true)
    await settled(service)

    advance(AUTO_SYNC_INTERVAL_MS - 1)
    expect(service.startIfDue()).toBe(false)
    advance(1)
    expect(service.startIfDue()).toBe(true)
    await settled(service)

    settings.autoSync = false
    advance(AUTO_SYNC_INTERVAL_MS)
    expect(service.startIfDue()).toBe(false)
  })

  it('cancels the active run on dispose and stops sending events', async () => {
    const { db, site, events, service } = setup()
    site.hold = () => true
    service.start({ full: false })
    await service.dispose()

    expect(lastFinishedRun(db)?.status).toBe('cancelled')
    expect(events).toEqual(['sync:progress'])
    expect(errorCode(() => service.start({ full: false }))).toBe('cancelled')
  })
})
