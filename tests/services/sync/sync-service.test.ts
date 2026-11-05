import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListingQuerySchema } from '@shared/domain'
import { AppError, isAppError } from '@shared/errors'
import { openDatabase, type AppDatabase } from '../../../src/main/db/client'
import { getListing, queryListings } from '../../../src/main/db/listing-store'
import { syncRuns } from '../../../src/main/db/schema'
import { lastFinishedRun } from '../../../src/main/db/sync-store'
import type { EmitEvent } from '../../../src/main/ipc/events'
import {
  AUTO_SYNC_INTERVAL_MS,
  AUTO_SYNC_RETRY_MS,
  createSyncService,
  type SyncService,
  type SyncSettings,
} from '../../../src/main/services/sync'
import { FakeSite, idOf, sitePage } from './fake-site'

const HOUR = 60 * 60 * 1000

const opened: Array<{ db: AppDatabase; service: SyncService }> = []

afterEach(async () => {
  for (const { db, service } of opened.splice(0)) {
    await service.dispose()
    db.$client.close()
  }
  vi.useRealTimers()
})

function setup(options: { offline?: boolean } = {}) {
  const db = openDatabase(':memory:')
  const site = new FakeSite()
  site.pages = [sitePage(1), sitePage(2)]
  const settings: SyncSettings = {
    syncBundeslaender: ['wien'],
    autoSync: true,
    firstRunCompletedAt: '2026-11-01T08:00:00.000Z',
  }
  const events: string[] = []
  const emit: EmitEvent = (event) => {
    events.push(event)
  }
  let time = Date.parse('2026-11-05T08:00:00.000Z')
  let wake: (() => void) | null = null
  const service = createSyncService({
    db,
    source: site,
    emit,
    readSettings: () => settings,
    offline: options.offline === true,
    onResume: (listener) => {
      wake = listener
      return () => {
        wake = null
      }
    },
    now: () => new Date(time),
  })
  opened.push({ db, service })
  return {
    db,
    site,
    settings,
    events,
    service,
    /** Time passes with the computer awake: fake timers run too. */
    advance: (ms: number): void => {
      time += ms
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms)
    },
    /** Time passes in sleep: timers stall. */
    sleep: (ms: number): void => {
      time += ms
    },
    resume: (): void => wake?.(),
    /** Saves settings the way the settings service reports them. */
    change: (patch: Partial<SyncSettings>): void => {
      const before = { ...settings }
      Object.assign(settings, patch)
      service.onSettingsChanged(before, { ...settings })
    },
  }
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

  it('runs again on its own timer and after the computer wakes', async () => {
    vi.useFakeTimers()
    const { events, service, advance, sleep, resume } = setup()
    expect(service.startIfDue()).toBe(true)
    await settled(service)

    advance(AUTO_SYNC_INTERVAL_MS - 1)
    expect(service.status().state).toBe('idle')
    advance(1)
    expect(service.status().state).toBe('running')
    await settled(service)
    expect(reloads(events)).toBe(2)

    sleep(AUTO_SYNC_INTERVAL_MS)
    expect(service.status().state).toBe('idle')
    resume()
    expect(service.status().state).toBe('running')
    await settled(service)
    expect(reloads(events)).toBe(3)
  })

  it('tries again soon after a run that did not reach the site', async () => {
    vi.useFakeTimers()
    const { site, service, advance } = setup()
    site.failWith = new AppError('network', 'Could not reach edikte.justiz.gv.at')
    expect(service.startIfDue()).toBe(true)
    await settled(service)
    expect(service.status().lastFinished?.status).toBe('failed')

    site.failWith = null
    advance(AUTO_SYNC_RETRY_MS - 1)
    expect(service.status().state).toBe('idle')
    advance(1)
    expect(service.status().state).toBe('running')
    await settled(service)
    expect(service.status().lastFinished?.status).toBe('ok')
  })

  it('waits for the first-run screen and never starts on its own offline', async () => {
    const { service, change } = setup()
    change({ firstRunCompletedAt: null })
    expect(service.startIfDue()).toBe(false)
    change({ firstRunCompletedAt: '2026-11-05T08:00:00.000Z' })
    expect(service.status().state).toBe('running')
    await settled(service)

    const offline = setup({ offline: true })
    expect(offline.service.startIfDue()).toBe(false)
    offline.change({ syncBundeslaender: ['wien', 'noe'] })
    expect(offline.service.status().state).toBe('idle')
    expect(reloads(offline.events)).toBe(1)
  })

  it('reloads the list for a new scope and syncs the part no run has covered', async () => {
    const { events, service, change } = setup()
    expect(service.startIfDue()).toBe(true)
    await settled(service)
    expect(reloads(events)).toBe(1)

    change({ syncBundeslaender: ['wien', 'noe'] })
    expect(reloads(events)).toBe(2)
    expect(service.status().state).toBe('running')
    await settled(service)
    expect(reloads(events)).toBe(3)

    // The last run covered Wien, so a smaller scope only reloads the list.
    change({ syncBundeslaender: ['wien'] })
    expect(reloads(events)).toBe(4)
    expect(service.status().state).toBe('idle')
    change({ autoSync: false })
    expect(reloads(events)).toBe(4)
  })

  it('picks up a scope change made during a run once the run ends', async () => {
    const { db, site, service, change } = setup()
    site.hold = () => true
    expect(service.startIfDue()).toBe(true)
    await vi.waitFor(() => {
      expect(site.waiting).toBe(1)
    })
    change({ syncBundeslaender: ['wien', 'noe'] })
    site.release()

    await vi.waitFor(() => {
      expect(
        db.select({ scope: syncRuns.scope, status: syncRuns.status }).from(syncRuns).all(),
      ).toEqual([
        { scope: ['wien'], status: 'ok' },
        { scope: ['wien', 'noe'], status: 'ok' },
      ])
    })
    await settled(service)
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
