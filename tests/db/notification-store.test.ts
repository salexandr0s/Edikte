import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ListingQuerySchema, type ListingQuery } from '@shared/domain'
import type { AlertConfig } from '@shared/notifications'
import { openDatabase, type AppDatabase } from '../../src/main/db/client'
import { loadListingSnapshot } from '../../src/main/db/listing-store'
import { createNotificationStore } from '../../src/main/db/notification-store'
import { alertMatches, edicts, listingDiscoveries, syncRuns } from '../../src/main/db/schema'
import { deleteFilter, saveFilter, updateUserState } from '../../src/main/db/user-store'
import { insertEdict } from './listing-fixtures'

const opened: AppDatabase[] = []
afterEach(() => {
  for (const db of opened.splice(0)) db.$client.close()
})
const at = (value: string) => new Date(value)
const START = at('2026-11-02T08:00:00.000Z')

function setup(query: Partial<ListingQuery> = {}) {
  const db = openDatabase(':memory:')
  opened.push(db)
  const filter = saveFilter(db, { name: 'Vienna homes', query: ListingQuerySchema.parse(query) })
  const store = createNotificationStore(db)
  const config: AlertConfig = {
    filterId: filter.id,
    enabled: true,
    cadence: 'after_sync',
    time: '09:00',
    weekday: 1,
    desktopEnabled: false,
  }
  store.updateRule(config, START)
  return { db, filter, store, config }
}

function discover(
  db: AppDatabase,
  n: number,
  options: {
    kind?: 'baseline' | 'live'
    committedAt?: string
    area?: number | null
  } = {},
) {
  const row = insertEdict(db, n, {
    objektgroesseSqm: options.area === undefined ? 80 : options.area,
  })
  const snapshot = loadListingSnapshot(db).find((item) => item.id === row.id)
  if (snapshot === undefined) throw new Error('Fixture listing is missing')
  const discovery = db
    .insert(listingDiscoveries)
    .values({
      caseKey: row.caseKey,
      source: row.source,
      bundesland: row.bundesland,
      firstSeenAt: '2026-11-01T07:59:00.000Z',
      committedAt: options.committedAt ?? '2026-11-03T08:01:00.000Z',
      kind: options.kind ?? 'live',
      snapshot,
    })
    .returning()
    .get()
  return { row, discovery }
}

describe('saved-search notification persistence', () => {
  it('matches committed discoveries once, skips baselines and retains immutable withdrawn history', () => {
    const { db, filter, store } = setup({ maxPricePerSqm: 5000 })
    discover(db, 1, { kind: 'baseline' })
    const { row } = discover(db, 2)
    store.processDiscoveries(at('2026-11-03T08:02:00Z'))
    const [batch] = store.deliverDue(at('2026-11-03T08:03:00Z'), true)
    expect(batch?.count).toBe(1)
    expect(store.deliverDue(at('2026-11-03T08:04:00Z'), true)).toEqual([])
    store.processDiscoveries(at('2026-11-03T08:05:00Z'))
    expect(store.deliverDue(at('2026-11-03T08:06:00Z'), true)).toEqual([])
    if (batch === undefined) throw new Error('Expected a digest')
    db.update(edicts)
      .set({ removedAt: '2026-11-04T08:00:00Z', schaetzwertEur: 999999 })
      .where(eq(edicts.id, row.id))
      .run()
    deleteFilter(db, filter.id)
    const history = store.getNotification(batch.id)
    expect(history.notification.filterId).toBeNull()
    expect(history.notification.count).toBe(1)
    expect(history.items).toHaveLength(1)
    expect(history.items[0]?.listing.schaetzwertEur).toBe(200000)
    expect(history.items[0]?.current?.removedAt).not.toBeNull()
  })

  it('does not make a known property new when its area later qualifies', () => {
    const { db, store } = setup({ maxPricePerSqm: 5000 })
    const { row } = discover(db, 1, { area: null })
    store.processDiscoveries(at('2026-11-03T08:02:00Z'))
    expect(store.deliverDue(at('2026-11-03T08:03:00Z'), true)).toEqual([])
    db.update(edicts).set({ objektgroesseSqm: 100 }).where(eq(edicts.id, row.id)).run()
    store.processDiscoveries(at('2026-11-04T08:02:00Z'))
    expect(store.deliverDue(at('2026-11-04T08:03:00Z'), true)).toEqual([])
  })

  it('does not miss a discovery fetched before a delivery cutoff but committed afterward', () => {
    const { db, store, config } = setup()
    store.updateRule({ ...config, cadence: 'daily' }, at('2026-11-02T07:00:00Z'))
    store.processDiscoveries(at('2026-11-02T08:00:00Z'))
    expect(store.deliverDue(at('2026-11-02T08:00:00Z'))).toEqual([])
    discover(db, 1, { committedAt: '2026-11-02T08:01:00.000Z' })
    store.processDiscoveries(at('2026-11-02T08:02:00Z'))
    const [batch] = createNotificationStore(db).deliverDue(at('2026-11-03T08:00:00Z'))
    expect(batch?.count).toBe(1)
    expect(batch?.periodFrom).toBe('2026-11-02T08:00:00.000Z')
  })

  it('preserves pending discoveries across schedule changes and restart catch-up', () => {
    const { db, store, config, filter } = setup()
    store.updateRule({ ...config, cadence: 'daily' }, START)
    discover(db, 1)
    store.processDiscoveries(at('2026-11-03T07:00:00Z'))
    const previous = store.getRule(filter.id, at('2026-11-03T07:00:00Z'))
    saveFilter(db, { id: filter.id, name: 'Renamed', query: filter.query })
    store.updateRule({ ...config, cadence: 'weekly' }, at('2026-11-03T07:00:00Z'))
    expect(store.getRule(filter.id).revision).toBe(previous.revision)
    const restarted = createNotificationStore(db)
    restarted.processDiscoveries(at('2026-11-23T10:00:00Z'))
    const batches = restarted.deliverDue(at('2026-11-23T10:00:00Z'))
    expect(batches).toHaveLength(1)
    expect(batches[0]?.filterName).toBe('Renamed')
    expect(batches[0]?.count).toBe(1)
    expect(restarted.deliverDue(at('2026-11-23T10:00:01Z'))).toEqual([])
  })

  it('rebaselines semantic filter edits and pause/re-enable without replaying discoveries', () => {
    const { db, store, config, filter } = setup()
    discover(db, 1)
    store.processDiscoveries(at('2026-11-03T08:02:00Z'))
    saveFilter(db, {
      id: filter.id,
      name: filter.name,
      query: { ...filter.query, maxPrice: 300000 },
    })
    store.reconcileRules(at('2026-11-03T08:03:00Z'))
    expect(store.deliverDue(at('2026-11-03T08:04:00Z'), true)).toEqual([])
    store.updateRule({ ...config, enabled: false }, at('2026-11-03T08:05:00Z'))
    discover(db, 2)
    store.updateRule(config, at('2026-11-03T08:06:00Z'))
    store.processDiscoveries(at('2026-11-03T08:07:00Z'))
    expect(store.deliverDue(at('2026-11-03T08:08:00Z'), true)).toEqual([])
  })

  it('rechecks hidden candidates and collapses merged case identities before batching', () => {
    const { db, store } = setup()
    const first = discover(db, 1)
    const second = discover(db, 2)
    const third = discover(db, 3)
    store.processDiscoveries(at('2026-11-03T08:02:00Z'))
    updateUserState(db, { caseKey: third.row.caseKey, hidden: true })
    db.update(listingDiscoveries)
      .set({ mergedIntoId: first.discovery.id, caseKey: null })
      .where(eq(listingDiscoveries.id, second.discovery.id))
      .run()
    const [batch] = store.deliverDue(at('2026-11-03T08:03:00Z'), true)
    expect(batch?.count).toBe(1)
    expect(
      db.select().from(alertMatches).where(eq(alertMatches.state, 'discarded')).all(),
    ).toHaveLength(2)
  })

  it('retains source failure coverage and persisted desktop-open/read state independently', () => {
    const { db, store } = setup()
    discover(db, 1)
    db.insert(syncRuns)
      .values({
        source: 'insolvency_sale',
        kind: 'full',
        status: 'failed',
        scope: ['wien'],
        startedAt: '2026-11-03T08:00:00Z',
        finishedAt: '2026-11-03T08:01:00Z',
      })
      .run()
    store.processDiscoveries(at('2026-11-03T08:02:00Z'))
    const [batch] = store.deliverDue(at('2026-11-03T08:03:00Z'), true)
    if (batch === undefined) throw new Error('Expected a digest')
    expect(batch.coverage.find((item) => item.source === 'insolvency_sale')?.lastRun?.status).toBe(
      'failed',
    )
    store.setDesktopStatus(
      batch.id,
      'failed',
      'test transport unavailable',
      at('2026-11-03T08:04:00Z'),
    )
    store.requestOpen(batch.id, at('2026-11-03T08:05:00Z'))
    const restarted = createNotificationStore(db)
    expect(restarted.pendingOpen()).toBe(batch.id)
    expect(restarted.listNotifications().unreadCount).toBe(1)
    restarted.ackOpen(batch.id)
    restarted.markRead(batch.id)
    expect(restarted.pendingOpen()).toBeNull()
    expect(restarted.listNotifications().unreadCount).toBe(0)
    expect(restarted.getNotification(batch.id).notification.desktopStatus).toBe('failed')
  })

  it('does not notify a discovered case corrected into an existing baseline property', () => {
    const { db, store } = setup()
    const baseline = discover(db, 1, { kind: 'baseline' })
    const live = discover(db, 2)
    store.processDiscoveries(at('2026-11-03T08:02:00Z'))
    db.update(listingDiscoveries)
      .set({ mergedIntoId: baseline.discovery.id, caseKey: null })
      .where(eq(listingDiscoveries.id, live.discovery.id))
      .run()
    expect(store.deliverDue(at('2026-11-03T08:03:00Z'), true)).toEqual([])
  })
})
