import { asc } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import type { SyncRunSummary } from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import { openDatabase, type AppDatabase } from '../../src/main/db/client'
import { documents, edicts } from '../../src/main/db/schema'
import {
  closeOpenRuns,
  createSyncStore,
  lastFinishedRun,
  loadSyncSchedule,
} from '../../src/main/db/sync-store'
import type { DocumentLink } from '../../src/main/scraper/detail'
import type { SyncCommit } from '../../src/main/scraper/sync'
import { edictId, edictRecord } from './listing-fixtures'

const T1 = '2026-11-04T08:00:00.000Z'
const T2 = '2026-11-04T14:00:00.000Z'
const T3 = '2026-11-05T08:00:00.000Z'
const T4 = '2026-11-05T14:00:00.000Z'

let db: AppDatabase | null = null

function open(): AppDatabase {
  db = openDatabase(':memory:')
  return db
}

afterEach(() => {
  db?.$client.close()
  db = null
})

function link(fileName: string): DocumentLink {
  return {
    kind: 'langgutachten',
    title: 'Langgutachten (pdf)',
    fileName,
    url: `https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/0/abc/$file/${fileName}`,
    statedSizeKb: 100,
  }
}

function commit(
  run: { id: number; kind: SyncRunSummary['kind']; startedAt: string },
  writes: Partial<SyncCommit> = {},
  status: SyncRunSummary['status'] = 'ok',
): SyncCommit {
  return {
    failureCode: null,
    summary: {
      ...run,
      status,
      finishedAt: run.startedAt,
      listed: 2,
      fetched: 2,
      changed: writes.upserts?.length ?? 0,
      removed: writes.removedIds?.length ?? 0,
      requests: 3,
      note: null,
    },
    errors: [],
    upserts: [],
    seenIds: [],
    unchangedIds: [],
    removedIds: [],
    at: run.startedAt,
    ...writes,
  }
}

const seenAt = (at: string) => ({ firstSeenAt: at, lastSeenAt: at, fetchedAt: at })

describe('sync store', () => {
  it('writes runs and edicts, keeping firstSeenAt and the state of known documents', async () => {
    const database = open()
    const store = createSyncStore(database)
    const empty = await store.loadState(['wien'])
    expect(empty.known.size).toBe(0)
    expect(empty.lastFinished).toBeNull()

    const first = { id: 0, kind: 'full' as const, startedAt: T1 }
    first.id = await store.startRun({ kind: 'full', scope: ['wien'], startedAt: T1 })
    await store.commitRun(
      commit(first, {
        upserts: [
          { edict: edictRecord(1, seenAt(T1)), documents: [link('gutachten.pdf')] },
          { edict: edictRecord(2, seenAt(T1)), documents: [] },
        ],
      }),
    )
    // The documents service downloads the Gutachten in between.
    database.update(documents).set({ localPath: 'abc/gutachten.pdf', downloadedAt: T1 }).run()

    const second = { id: 0, kind: 'incremental' as const, startedAt: T2 }
    second.id = await store.startRun({ kind: 'incremental', scope: ['wien'], startedAt: T2 })
    const corrected = edictRecord(1, { ...seenAt(T2), title: 'Wohnung Top 1 (berichtigt)' })
    await store.commitRun(
      commit(second, {
        upserts: [{ edict: corrected, documents: [link('gutachten.pdf'), link('plan.pdf')] }],
        unchangedIds: [edictId(2)],
      }),
    )

    const third = { id: 0, kind: 'full' as const, startedAt: T3 }
    third.id = await store.startRun({ kind: 'full', scope: ['wien'], startedAt: T3 })
    await store.commitRun(commit(third, { seenIds: [edictId(1)], removedIds: [edictId(2)] }))

    // A degraded run records its summary and writes nothing.
    const fourth = { id: 0, kind: 'full' as const, startedAt: T4 }
    fourth.id = await store.startRun({ kind: 'full', scope: ['wien'], startedAt: T4 })
    await store.commitRun(commit(fourth, {}, 'degraded'))

    const stored = new Map(
      database
        .select()
        .from(edicts)
        .all()
        .map((row) => [row.id, row]),
    )
    expect(stored.get(edictId(1))).toMatchObject({
      title: 'Wohnung Top 1 (berichtigt)',
      firstSeenAt: T1,
      lastSeenAt: T3,
      fetchedAt: T2,
      removedAt: null,
    })
    expect(stored.get(edictId(2))).toMatchObject({ lastSeenAt: T2, fetchedAt: T2, removedAt: T3 })
    const links = database.select().from(documents).orderBy(asc(documents.id)).all()
    expect(links.map((row) => [row.fileName, row.localPath])).toEqual([
      ['gutachten.pdf', 'abc/gutachten.pdf'],
      ['plan.pdf', null],
    ])

    const state = await store.loadState(['wien'])
    expect([...state.known.keys()].sort()).toEqual([edictId(1), edictId(2)])
    expect(state.known.get(edictId(2))?.removedAt).toBe(T3)
    expect(state).toMatchObject({
      lastOkRunStartedAt: T3,
      lastOkFullRunStartedAt: T3,
      lastFinished: { id: fourth.id, status: 'degraded' },
    })
    // No ok run covered Niederösterreich.
    expect((await store.loadState(['wien', 'noe'])).lastOkRunStartedAt).toBeNull()
  })

  it('closes runs left open by a quit; cancelled runs do not settle the schedule', async () => {
    const database = open()
    const store = createSyncStore(database)
    const ok = { id: 0, kind: 'full' as const, startedAt: T1 }
    ok.id = await store.startRun({ kind: 'full', scope: ['wien', 'noe'], startedAt: T1 })
    await store.commitRun(commit(ok))
    await store.startRun({ kind: 'incremental', scope: ['wien'], startedAt: T2 })

    closeOpenRuns(database, { status: 'cancelled', note: 'Closed', finishedAt: null })
    expect(lastFinishedRun(database)).toMatchObject({ status: 'cancelled', finishedAt: T2 })
    expect(loadSyncSchedule(database, ['wien'])).toEqual({ settledAt: T1, unsettledAt: T2 })
    expect(loadSyncSchedule(database, ['wien', 'ooe'])).toEqual({
      settledAt: null,
      unsettledAt: null,
    })
  })

  it('counts a failed run as settled only when the site answered', async () => {
    const database = open()
    const store = createSyncStore(database)
    const finish = async (
      startedAt: string,
      status: SyncRunSummary['status'],
      failureCode: AppErrorCode | null,
    ): Promise<void> => {
      const id = await store.startRun({ kind: 'full', scope: ['wien'], startedAt })
      await store.commitRun(commit({ id, kind: 'full', startedAt }, { failureCode }, status))
    }

    await finish(T1, 'ok', null)
    await finish(T2, 'failed', 'network')
    expect(loadSyncSchedule(database, ['wien'])).toEqual({ settledAt: T1, unsettledAt: T2 })
    await finish(T3, 'failed', 'site_unavailable')
    expect(loadSyncSchedule(database, ['wien'])).toEqual({ settledAt: T3, unsettledAt: T2 })
    await store.startRun({ kind: 'incremental', scope: ['wien'], startedAt: T4 })
    closeOpenRuns(database, {
      status: 'failed',
      note: 'Not saved',
      finishedAt: T4,
      failureCode: 'storage_unavailable',
    })
    expect(loadSyncSchedule(database, ['wien'])).toEqual({ settledAt: T3, unsettledAt: T4 })
  })
})
