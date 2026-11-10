import type { SyncRunSummary, SyncStatus } from '@shared/domain'
import type { Bundesland, EdictSource, NoticeType } from '@shared/enums'
import { AppError, isAppError, type AppErrorCode } from '@shared/errors'
import type { DocumentLink } from './detail'
import type { EdictRecord } from './edict-record'
import { exceedsShare } from './health'
import type { ChangedPage, PageResult, SiteRun, SyncRow, SyncSite } from './sync-site'

const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000
const FAILED_PAGE_LIMIT = 0.2
const MASS_REMOVAL_MIN = 10
const MAX_ERRORS = 100

type Awaitable<T> = T | Promise<T>
type RunKind = SyncRunSummary['kind']
type Phase = NonNullable<SyncStatus['phase']>

/** What the store knows about an edict; enough to decide whether to read its page again. */
export interface KnownEdict {
  id: string
  noticeType: NoticeType
  bundesland: Bundesland | null
  contentHash: string
  parserVersion: number
  auctionAt: string | null
  fetchedAt: string
  removedAt: string | null
}

/** What the store holds for one source over one scope. */
export interface SyncStoreState {
  /** Stored edicts of the source whose Bundesland is in scope, removed ones included. */
  known: ReadonlyMap<string, KnownEdict>
  /** Start of the source's last run with status ok whose scope covered this one. */
  lastOkRunStartedAt: string | null
  /** The same for full runs. */
  lastOkFullRunStartedAt: string | null
}

export interface SyncRunStart {
  source: EdictSource
  kind: RunKind
  scope: Bundesland[]
  startedAt: string
}

export interface EdictWrite {
  edict: EdictRecord
  /** Every document link on the page. */
  documents: DocumentLink[]
}

/** Result of a run, applied by the store in one transaction. Runs that are not ok carry no writes. */
export interface SyncCommit {
  summary: SyncRunSummary
  /** Code of the error that ended a failed run; null for other runs. */
  failureCode: AppErrorCode | null
  errors: string[]
  /** New and changed edicts: insert or update, keeping firstSeenAt of an existing row. */
  upserts: EdictWrite[]
  /** Listed, page not read: set lastSeenAt. */
  seenIds: string[]
  /** Page read and unchanged: set lastSeenAt and fetchedAt. */
  unchangedIds: string[]
  /** Missing from a complete full list: set removedAt. */
  removedIds: string[]
  /** Time for lastSeenAt, fetchedAt and removedAt. */
  at: string
}

export interface SyncStore {
  loadState(scope: readonly Bundesland[], source: EdictSource): Awaitable<SyncStoreState>
  /** Records a run with status running and returns its ID. */
  startRun(run: SyncRunStart): Awaitable<number>
  commitRun(commit: SyncCommit): Awaitable<void>
}

/** Where a run stands. The service turns it into the status the renderer sees. */
export interface RunProgress {
  phase: Phase
  done: number
  total: number
  /** A copy of the run's summary so far. */
  current: SyncRunSummary
}

export interface SyncOptions<Row extends SyncRow = SyncRow, Page = unknown> {
  site: SyncSite<Row, Page>
  store: SyncStore
  scope: readonly Bundesland[]
  signal?: AbortSignal
  onProgress?: (progress: RunProgress) => void
  now?: () => Date
  forceFull?: boolean
}

interface RunResult {
  upserts: EdictWrite[]
  seenIds: string[]
  unchangedIds: string[]
  removedIds: string[]
  degradedNote: string | null
  note: string | null
}

/** Runs one source. Failed, cancelled and degraded runs write no edicts. */
export async function runSync<Row extends SyncRow, Page>(
  options: SyncOptions<Row, Page>,
): Promise<SyncRunSummary> {
  const { site, store, signal, onProgress } = options
  const now = options.now ?? (() => new Date())
  const scope = [...new Set(options.scope)]
  const state = await store.loadState(scope, site.source)
  const startedAt = now().toISOString()
  const kind = chooseKind(state, startedAt, options.forceFull === true, site)
  const summary: SyncRunSummary = {
    id: await store.startRun({ source: site.source, kind, scope, startedAt }),
    source: site.source,
    kind,
    status: 'running',
    startedAt,
    finishedAt: null,
    listed: 0,
    fetched: 0,
    changed: 0,
    removed: 0,
    requests: 0,
    note: null,
  }
  const requestsAtStart = site.requestCount
  const errors: string[] = []
  const report = (phase: Phase, done: number, total: number): void => {
    summary.requests = site.requestCount - requestsAtStart
    onProgress?.({ phase, done, total, current: { ...summary } })
  }
  const run: SiteRun = {
    signal,
    state,
    scope,
    kind,
    startedAt,
    now,
    errors,
    report,
    attempt: (label, read) => readPage(signal, errors, label, read),
  }
  let result: RunResult | null = null
  let failureCode: AppErrorCode | null = null
  try {
    throwIfCancelled(signal)
    result = await executeRun(run, site, summary)
  } catch (error) {
    const failure = toAppError(error)
    summary.status = failure.code === 'cancelled' ? 'cancelled' : 'failed'
    summary.note = failure.code === 'cancelled' ? null : `${failure.code}: ${failure.message}`
    if (failure.code !== 'cancelled') failureCode = failure.code
  }
  const finishedAt = now().toISOString()
  const writes = result !== null && result.degradedNote === null ? result : null
  if (result !== null) {
    summary.status = writes === null ? 'degraded' : 'ok'
    summary.note = result.degradedNote ?? result.note
  }
  summary.finishedAt = finishedAt
  summary.requests = site.requestCount - requestsAtStart
  summary.changed = writes?.upserts.length ?? 0
  summary.removed = writes?.removedIds.length ?? 0
  await store.commitRun({
    summary: { ...summary },
    failureCode,
    errors: errors.slice(0, MAX_ERRORS),
    upserts: writes?.upserts ?? [],
    seenIds: writes?.seenIds ?? [],
    unchangedIds: writes?.unchangedIds ?? [],
    removedIds: writes?.removedIds ?? [],
    at: finishedAt,
  })
  return summary
}

function chooseKind<Row extends SyncRow, Page>(
  state: SyncStoreState,
  startedAt: string,
  forceFull: boolean,
  site: SyncSite<Row, Page>,
): RunKind {
  const lastFull = state.lastOkFullRunStartedAt
  if (!site.incrementalList || forceFull || lastFull === null || state.lastOkRunStartedAt === null)
    return 'full'
  for (const edict of state.known.values()) {
    if (edict.removedAt === null && edict.parserVersion < site.parserVersion) return 'full'
  }
  return Date.parse(startedAt) - Date.parse(lastFull) >= FULL_SYNC_INTERVAL_MS
    ? 'full'
    : 'incremental'
}

async function executeRun<Row extends SyncRow, Page>(
  run: SiteRun,
  site: SyncSite<Row, Page>,
  summary: SyncRunSummary,
): Promise<RunResult> {
  const listing = await site.list(run)
  summary.listed = listing.rows.size
  run.report('list', run.scope.length, run.scope.length)
  const known = run.state.known
  const toFetch: Row[] = []
  const seenIds: string[] = []
  for (const row of listing.rows.values()) {
    if (site.needsPage(run, row, known.get(row.id))) toFetch.push(row)
    else seenIds.push(row.id)
  }
  const pages: ChangedPage<Row, Page>[] = []
  const changed: ChangedPage<Row, Page>[] = []
  const unchangedIds: string[] = []
  let failed = 0
  let gone = 0
  for (const [index, row] of toFetch.entries()) {
    run.report('details', index, toFetch.length)
    const result = await run.attempt(row.id, () => site.readPage(run, row))
    if (!result.ok) {
      if (result.gone) gone += 1
      else failed += 1
      continue
    }
    const page = result.value
    summary.fetched += 1
    pages.push({ row, page })
    const before = known.get(row.id)
    if (
      before !== undefined &&
      before.contentHash === site.contentHash(page) &&
      before.parserVersion === site.parserVersion &&
      before.removedAt === null
    )
      unchangedIds.push(row.id)
    else changed.push({ row, page })
  }
  run.report('details', toFetch.length, toFetch.length)
  const upserts = await site.finish(run, changed)
  throwIfCancelled(run.signal)
  const problems: string[] = []
  const healthNote = site.assessHealth({ rows: [...listing.rows.values()], pages })
  if (healthNote !== null) problems.push(healthNote)
  const attempted = toFetch.length - gone
  if (exceedsShare(failed, attempted, FAILED_PAGE_LIMIT))
    problems.push(`${failed} of ${attempted} edict pages could not be read`)
  let removedIds: string[] = []
  let note: string | null = null
  if (run.kind === 'full' && listing.incomplete !== null) {
    note = `${listing.incomplete}, so no edicts were marked as removed`
  } else if (run.kind === 'full') {
    const active = [...known.values()].filter(
      (edict) =>
        edict.removedAt === null &&
        edict.bundesland !== null &&
        run.scope.includes(edict.bundesland),
    )
    removedIds = active.filter((edict) => !listing.rows.has(edict.id)).map((edict) => edict.id)
    if (removedIds.length > MASS_REMOVAL_MIN && removedIds.length > active.length / 2)
      problems.push(`The list would remove ${removedIds.length} of ${active.length} edicts`)
  }
  return {
    upserts,
    seenIds,
    unchangedIds,
    removedIds,
    degradedNote: problems.length > 0 ? problems.join('; ') : null,
    note,
  }
}

async function readPage<T>(
  signal: AbortSignal | undefined,
  errors: string[],
  label: string,
  read: () => Promise<T>,
): Promise<PageResult<T>> {
  throwIfCancelled(signal)
  try {
    return { ok: true, value: await read() }
  } catch (error) {
    const failure = toAppError(error)
    if (['cancelled', 'site_unavailable', 'rate_limited'].includes(failure.code)) throw failure
    errors.push(`${label}: ${failure.code}: ${failure.message}`)
    return { ok: false, gone: failure.code === 'not_found' }
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new AppError('cancelled', 'Cancelled')
}

function toAppError(error: unknown): AppError {
  return isAppError(error)
    ? error
    : new AppError('internal', 'Unexpected error during sync', { cause: error })
}
