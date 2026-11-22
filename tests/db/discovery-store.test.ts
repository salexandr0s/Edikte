import { asc, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import type { Bundesland, EdictSource } from '@shared/enums'
import { openDatabase, type AppDatabase } from '../../src/main/db/client'
import {
  loadDiscoveryMetadata,
  resolveDiscoveryId,
  seedDiscoveryBaseline,
} from '../../src/main/db/discovery-store'
import { loadListingSnapshot } from '../../src/main/db/listing-store'
import { edicts, listingDiscoveries, syncRuns } from '../../src/main/db/schema'
import { readSourceCoverage } from '../../src/main/db/notification-store'
import { createSyncStore, loadSyncSchedule, loadSyncState } from '../../src/main/db/sync-store'
import type { EdictRecord } from '../../src/main/scraper/edict-record'
import type { SyncCommit } from '../../src/main/scraper/sync'
import { edictId, edictRecord, insertEdict, T0 } from './listing-fixtures'

const T1 = '2026-11-02T08:00:00.000Z'
const T2 = '2026-11-03T08:00:00.000Z'
const databases: AppDatabase[] = []

function open(): AppDatabase {
  const db = openDatabase(':memory:')
  databases.push(db)
  return db
}

afterEach(() => {
  for (const db of databases.splice(0)) db.$client.close()
})

async function sync(
  db: AppDatabase,
  rows: EdictRecord[],
  at: string,
  options: {
    source?: EdictSource
    scope?: Bundesland[]
    status?: SyncCommit['summary']['status']
    removedIds?: string[]
    note?: string
  } = {},
): Promise<void> {
  const store = createSyncStore(db)
  const source = options.source ?? 'court_auction'
  const id = await store.startRun({
    source,
    scope: options.scope ?? ['wien'],
    kind: 'full',
    startedAt: at,
  })
  await store.commitRun({
    summary: {
      id,
      source,
      kind: 'full',
      status: options.status ?? 'ok',
      startedAt: at,
      finishedAt: at,
      listed: rows.length,
      fetched: rows.length,
      changed: rows.length,
      removed: 0,
      requests: 1,
      note: options.note ?? null,
    },
    at,
    errors: [],
    failureCode: null,
    upserts: rows.map((edict) => ({ edict, documents: [] })),
    seenIds: rows.map((row) => row.id),
    unchangedIds: [],
    retryIds: [],
    removedIds: options.removedIds ?? [],
  })
}

describe('discovery journal', () => {
  it('baselines first imports per source and region and timestamps live discoveries at commit', async () => {
    const db = open()
    await sync(db, [edictRecord(1)], T0)
    await sync(db, [edictRecord(2, { objektgroesseSqm: 50 })], T1)
    await sync(db, [edictRecord(3, { bundesland: 'noe' })], T1, {
      scope: ['wien', 'noe'],
    })
    await sync(
      db,
      [
        edictRecord(4, {
          id: 'mv-4',
          caseKey: 'insolvency:4',
          source: 'insolvency_sale',
          status: 'on_offer',
        }),
      ],
      T1,
      { source: 'insolvency_sale' },
    )
    const rows = db.select().from(listingDiscoveries).orderBy(asc(listingDiscoveries.id)).all()
    expect(rows.map((row) => row.kind)).toEqual(['baseline', 'live', 'baseline', 'baseline'])
    expect(rows[1]).toMatchObject({ firstSeenAt: T0, committedAt: T1 })
    expect(rows[1]?.snapshot).toMatchObject({
      id: edictId(2),
      priceBasis: 'schaetzwert',
      pricePerSqm: 4000,
    })
    await sync(db, [edictRecord(2, { schaetzwertEur: 999_000, objektgroesseSqm: 50 })], T2)
    expect(db.select().from(listingDiscoveries).all()).toHaveLength(4)
    expect(
      db.select().from(listingDiscoveries).where(eq(listingDiscoveries.id, rows[1]!.id)).get()
        ?.snapshot?.schaetzwertEur,
    ).toBe(200_000)
  })

  it('keeps an incomplete import without treating its region as fully covered', async () => {
    const db = open()
    await sync(db, [edictRecord(1)], T0, { note: 'List incomplete' })
    expect(loadListingSnapshot(db)).toHaveLength(1)
    expect(readSourceCoverage(db).find((item) => item.source === 'court_auction')).toMatchObject({
      lastRun: { status: 'ok', note: 'List incomplete' },
      lastSuccessAt: null,
    })
    expect(loadSyncState(db, ['wien'], 'court_auction').lastOkFullRunStartedAt).toBeNull()
    expect(loadSyncSchedule(db, ['wien'], 'court_auction').settledAt).toBe(T0)

    await sync(db, [edictRecord(2)], T1)
    await sync(db, [edictRecord(3)], T2)
    expect(
      db
        .select()
        .from(listingDiscoveries)
        .orderBy(asc(listingDiscoveries.id))
        .all()
        .map((discovery) => discovery.kind),
    ).toEqual(['baseline', 'baseline', 'live'])
    expect(loadSyncState(db, ['wien'], 'court_auction').lastOkFullRunStartedAt).toBe(T2)
  })

  it('does not rediscover removed cases or reissued notices and keeps earliest history', async () => {
    const db = open()
    insertEdict(db, 1, { caseKey: 'known', removedAt: T1, firstSeenAt: T0 })
    seedDiscoveryBaseline(db, new Date(T1))
    seedDiscoveryBaseline(db, new Date(T2))
    await sync(db, [edictRecord(2, { caseKey: 'known', firstSeenAt: T2 })], T2)
    expect(db.select().from(listingDiscoveries).all()).toHaveLength(1)
    expect(loadDiscoveryMetadata(db).get('known')).toMatchObject({
      kind: 'baseline',
      firstSeenAt: T0,
      committedAt: T1,
    })
    expect(loadListingSnapshot(db)).toHaveLength(1)
  })

  it('retains journal aliases when case corrections merge two identities', async () => {
    const db = open()
    await sync(db, [edictRecord(1, { caseKey: 'older' })], T0)
    await sync(db, [edictRecord(2, { caseKey: 'newer', firstSeenAt: T1 })], T1)
    const [older, newer] = db
      .select()
      .from(listingDiscoveries)
      .orderBy(asc(listingDiscoveries.id))
      .all()
    await sync(db, [edictRecord(2, { caseKey: 'older', firstSeenAt: T2 })], T2)
    expect(db.select().from(listingDiscoveries).all()).toHaveLength(2)
    expect(
      db.select().from(listingDiscoveries).where(eq(listingDiscoveries.id, newer!.id)).get(),
    ).toMatchObject({ caseKey: 'newer', mergedIntoId: older!.id })
    expect(resolveDiscoveryId(db, newer!.id)).toBe(older!.id)
    expect(loadDiscoveryMetadata(db).get('older')).toMatchObject({
      id: older!.id,
      firstSeenAt: T0,
      kind: 'baseline',
    })
    expect(db.select({ caseKey: edicts.caseKey }).from(edicts).all()).toEqual([
      { caseKey: 'older' },
      { caseKey: 'older' },
    ])
    expect(loadListingSnapshot(db)).toHaveLength(1)
    await sync(db, [edictRecord(3, { caseKey: 'newer', firstSeenAt: T2 })], T2)
    expect(db.select().from(listingDiscoveries).all()).toHaveLength(2)
    expect(loadListingSnapshot(db)).toHaveLength(1)
  })

  it('creates no discoveries for unsuccessful syncs and rolls back when journal persistence fails', async () => {
    const db = open()
    await sync(db, [edictRecord(1)], T0, { status: 'degraded' })
    expect(db.select().from(edicts).all()).toEqual([])
    expect(db.select().from(listingDiscoveries).all()).toEqual([])
    db.$client.exec(
      "CREATE TRIGGER fail_discovery BEFORE INSERT ON listing_discoveries BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    )
    await expect(sync(db, [edictRecord(1)], T1)).rejects.toThrow('fixture failure')
    expect(db.select().from(edicts).all()).toEqual([])
    expect(db.select().from(listingDiscoveries).all()).toEqual([])
    expect(db.select().from(syncRuns).orderBy(asc(syncRuns.id)).all().at(-1)?.status).toBe(
      'running',
    )
  })
})
