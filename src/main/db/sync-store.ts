import { and, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm'
import type { SyncRunSummary } from '@shared/domain'
import type { Bundesland, EdictSource } from '@shared/enums'
import type { AppErrorCode } from '@shared/errors'
import type {
  EdictWrite,
  KnownEdict,
  SyncCommit,
  SyncRunStart,
  SyncStore,
  SyncStoreState,
} from '../scraper/sync'
import type { AppDatabase } from './client'
import { documents, edicts, syncRuns, userState } from './schema'

/** IDs per `UPDATE … WHERE id IN (…)`, far below SQLite's variable limit. */
const ID_CHUNK = 500
/** Runs read per query while looking for the newest ones that cover a scope. */
const RUN_PAGE = 50

type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0]
type SyncRunStatus = (typeof syncRuns.$inferSelect)['status']

const summaryColumns = {
  id: syncRuns.id,
  source: syncRuns.source,
  kind: syncRuns.kind,
  status: syncRuns.status,
  startedAt: syncRuns.startedAt,
  finishedAt: syncRuns.finishedAt,
  listed: syncRuns.listed,
  fetched: syncRuns.fetched,
  changed: syncRuns.changed,
  removed: syncRuns.removed,
  requests: syncRuns.requests,
  note: syncRuns.note,
} satisfies Record<keyof SyncRunSummary, unknown>

/** The database side of `runSync`. */
export function createSyncStore(db: AppDatabase): SyncStore {
  return {
    loadState: (scope, source) => loadSyncState(db, scope, source),
    startRun: (run) => insertRun(db, run),
    commitRun: (commit) => applyCommit(db, commit),
  }
}

/**
 * The edicts and runs of one source. A run compares the site's list with this
 * state alone, so it never marks an edict of another source as removed.
 */
export function loadSyncState(
  db: AppDatabase,
  scope: readonly Bundesland[],
  source: EdictSource,
): SyncStoreState {
  const known = new Map<string, KnownEdict>()
  if (scope.length > 0) {
    const rows = db
      .select({
        id: edicts.id,
        noticeType: edicts.noticeType,
        bundesland: edicts.bundesland,
        contentHash: edicts.contentHash,
        parserVersion: edicts.parserVersion,
        auctionAt: edicts.auctionAt,
        fetchedAt: edicts.fetchedAt,
        removedAt: edicts.removedAt,
      })
      .from(edicts)
      .where(and(eq(edicts.source, source), inArray(edicts.bundesland, [...scope])))
      .all()
    for (const row of rows) known.set(row.id, row)
  }
  let lastOkRunStartedAt: string | null = null
  let lastOkFullRunStartedAt: string | null = null
  for (const run of newestCoveringRuns(db, eq(syncRuns.status, 'ok'), scope, source)) {
    lastOkRunStartedAt ??= run.startedAt
    if (run.kind === 'full') {
      lastOkFullRunStartedAt = run.startedAt
      break
    }
  }
  return { known, lastOkRunStartedAt, lastOkFullRunStartedAt }
}

/** The newest run of a source with a finish time, whatever its scope or status. */
export function lastFinishedRun(db: AppDatabase, source: EdictSource): SyncRunSummary | null {
  return (
    db
      .select(summaryColumns)
      .from(syncRuns)
      .where(and(eq(syncRuns.source, source), isNotNull(syncRuns.finishedAt)))
      .orderBy(desc(syncRuns.id))
      .limit(1)
      .get() ?? null
  )
}

/** Failures that come from an answer of the site, so retrying soon would not help. */
const SITE_ANSWER_CODES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'site_unavailable',
  'rate_limited',
  'site_changed',
])

/**
 * Finish times of the newest runs of one source covering a scope, which decide
 * when auto sync is due.
 */
export interface SyncSchedule {
  /** The newest run that got an answer from the site: ok, degraded, or failed with a site error. */
  settledAt: string | null
  /** The newest run that ended without one: cancelled, or failed before the site answered. */
  unsettledAt: string | null
}

export function loadSyncSchedule(
  db: AppDatabase,
  scope: readonly Bundesland[],
  source: EdictSource,
): SyncSchedule {
  const schedule: SyncSchedule = { settledAt: null, unsettledAt: null }
  for (const run of newestCoveringRuns(db, isNotNull(syncRuns.finishedAt), scope, source)) {
    if (isSettled(run)) schedule.settledAt ??= run.finishedAt
    else schedule.unsettledAt ??= run.finishedAt
    if (schedule.settledAt !== null && schedule.unsettledAt !== null) break
  }
  return schedule
}

/** Runs of `source` matching `where` that covered `scope`, newest first, read a page at a time. */
function* newestCoveringRuns(
  db: AppDatabase,
  where: SQL,
  scope: readonly Bundesland[],
  source: EdictSource,
) {
  for (let offset = 0; ; offset += RUN_PAGE) {
    const page = db
      .select({
        kind: syncRuns.kind,
        scope: syncRuns.scope,
        status: syncRuns.status,
        failureCode: syncRuns.failureCode,
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
      })
      .from(syncRuns)
      .where(and(eq(syncRuns.source, source), where))
      .orderBy(desc(syncRuns.id))
      .limit(RUN_PAGE)
      .offset(offset)
      .all()
    for (const run of page) {
      if (covers(run.scope, scope)) yield run
    }
    if (page.length < RUN_PAGE) return
  }
}

function isSettled(run: { status: SyncRunStatus; failureCode: AppErrorCode | null }): boolean {
  if (run.status === 'failed') {
    return run.failureCode !== null && SITE_ANSWER_CODES.has(run.failureCode)
  }
  return run.status === 'ok' || run.status === 'degraded'
}

/**
 * Ends runs still marked running, such as one cut off when the app quit.
 * Without `finishedAt` the run's start time is used.
 */
export function closeOpenRuns(
  db: AppDatabase,
  close: {
    status: 'failed' | 'cancelled'
    note: string
    finishedAt: string | null
    failureCode?: AppErrorCode
  },
): void {
  db.update(syncRuns)
    .set({
      status: close.status,
      note: close.note,
      finishedAt: close.finishedAt ?? sql`${syncRuns.startedAt}`,
      failureCode: close.failureCode ?? null,
    })
    .where(eq(syncRuns.status, 'running'))
    .run()
}

function insertRun(db: AppDatabase, run: SyncRunStart): number {
  return db
    .insert(syncRuns)
    .values({
      source: run.source,
      kind: run.kind,
      status: 'running',
      scope: run.scope,
      startedAt: run.startedAt,
    })
    .returning({ id: syncRuns.id })
    .get().id
}

/**
 * Writes a finished run in one transaction; runs that are not ok carry no edict
 * writes. A failed run without a failure code counts as not settled.
 */
function applyCommit(db: AppDatabase, commit: SyncCommit): void {
  const { summary, at } = commit
  db.transaction((tx) => {
    tx.update(syncRuns)
      .set({
        status: summary.status,
        finishedAt: summary.finishedAt ?? at,
        listed: summary.listed,
        fetched: summary.fetched,
        changed: summary.changed,
        removed: summary.removed,
        requests: summary.requests,
        note: summary.note,
        errors: commit.errors,
        failureCode: summary.status === 'failed' ? commit.failureCode : null,
      })
      .where(eq(syncRuns.id, summary.id))
      .run()
    if (summary.status !== 'ok') return
    for (const write of commit.upserts) {
      if (write.edict.source === summary.source) upsertEdict(tx, write, at)
    }
    for (const ids of chunks(commit.seenIds)) {
      tx.update(edicts)
        .set({ lastSeenAt: at })
        .where(and(eq(edicts.source, summary.source), inArray(edicts.id, ids)))
        .run()
    }
    for (const ids of chunks(commit.unchangedIds)) {
      tx.update(edicts)
        .set({ lastSeenAt: at, fetchedAt: at })
        .where(and(eq(edicts.source, summary.source), inArray(edicts.id, ids)))
        .run()
    }
    for (const ids of chunks(commit.removedIds)) {
      tx.update(edicts)
        .set({ removedAt: at })
        .where(and(eq(edicts.source, summary.source), inArray(edicts.id, ids)))
        .run()
    }
  })
}

/**
 * Inserts or replaces the edict, keeping the stored firstSeenAt, and adds
 * document links it does not know yet. Missing links are retired; returning
 * links keep their download and extraction state.
 */
function upsertEdict(tx: Transaction, write: EdictWrite, at: string): void {
  const { edict } = write
  const stored = tx
    .select({ caseKey: edicts.caseKey })
    .from(edicts)
    .where(eq(edicts.id, edict.id))
    .get()
  if (stored !== undefined && stored.caseKey !== edict.caseKey) {
    moveUserState(tx, stored.caseKey, edict.caseKey, at)
  }
  tx.insert(edicts)
    .values(edict)
    .onConflictDoUpdate({
      target: edicts.id,
      // In an upsert, the table's own column is the value of the existing row.
      set: { ...edict, firstSeenAt: sql`${edicts.firstSeenAt}` },
    })
    .run()
  const publishedUrls = new Set(write.documents.map((link) => link.url))
  const storedDocuments = tx
    .select({ id: documents.id, url: documents.url, removedAt: documents.removedAt })
    .from(documents)
    .where(eq(documents.edictId, edict.id))
    .all()
  for (const document of storedDocuments) {
    const removedAt = publishedUrls.has(document.url) ? null : (document.removedAt ?? at)
    if (removedAt !== document.removedAt) {
      tx.update(documents).set({ removedAt }).where(eq(documents.id, document.id)).run()
    }
  }
  if (write.documents.length === 0) return
  tx.insert(documents)
    .values(
      write.documents.map((link) => ({
        edictId: edict.id,
        kind: link.kind,
        title: link.title,
        fileName: link.fileName,
        url: link.url,
        statedSizeKb: link.statedSizeKb,
        createdAt: at,
      })),
    )
    .onConflictDoNothing({ target: [documents.edictId, documents.url] })
    .run()
}

/**
 * Moves star, hide and notes to an edict's new case key, as after a parser
 * change to case keys. When two cases now share one key, a star from either
 * stays, the case stays hidden only when both were, and both notes are kept.
 */
function moveUserState(tx: Transaction, from: string, to: string, at: string): void {
  const moving = tx.select().from(userState).where(eq(userState.caseKey, from)).get()
  if (moving === undefined) return
  const existing = tx.select().from(userState).where(eq(userState.caseKey, to)).get()
  if (existing === undefined) {
    tx.update(userState).set({ caseKey: to }).where(eq(userState.caseKey, from)).run()
    return
  }
  tx.update(userState)
    .set({
      starred: existing.starred || moving.starred,
      hidden: existing.hidden && moving.hidden,
      notes: [existing.notes, moving.notes].filter((notes) => notes !== '').join('\n\n'),
      updatedAt: at,
    })
    .where(eq(userState.caseKey, to))
    .run()
  tx.delete(userState).where(eq(userState.caseKey, from)).run()
}

/** Whether a run over `runScope` covered every Bundesland of `scope`. */
function covers(runScope: readonly Bundesland[], scope: readonly Bundesland[]): boolean {
  return scope.every((bundesland) => runScope.includes(bundesland))
}

function* chunks<T>(items: readonly T[]): Generator<T[]> {
  for (let start = 0; start < items.length; start += ID_CHUNK) {
    yield items.slice(start, start + ID_CHUNK)
  }
}
