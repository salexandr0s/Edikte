import type { KurzgutachtenFacts, SyncRunSummary, SyncStatus } from '@shared/domain'
import type { Bundesland, NoticeType } from '@shared/enums'
import { AppError, isAppError, type AppErrorCode } from '@shared/errors'
import type { PageSource } from './client'
import { parseDetailPage, type DocumentLink, type ParsedDetail } from './detail'
import { buildEdictRecord, type EdictRecord } from './edict-record'
import { assessRunHealth, exceedsShare, type HealthSample } from './health'
import { parseKurzgutachten } from './kurzgutachten'
import { PARSER_VERSION } from './parser-version'
import { SEARCH_MAX, buildSearchUrl, parseSearchResults, type SearchRow } from './search'

const DAY_MS = 24 * 60 * 60 * 1000

/** A full run, the only kind that notices removed edicts, happens at most once a day. */
const FULL_SYNC_INTERVAL_MS = DAY_MS
/** Full runs read a page again after this long, as an edit does not always show in the list. */
const REFRESH_AFTER_MS = 7 * DAY_MS
/** Share of detail pages that may fail to load or parse before a run counts as degraded. */
const FAILED_PAGE_LIMIT = 0.2
/** A list that would remove more than half of the known edicts, and more than this many, is not trusted. */
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

export interface SyncStoreState {
  /** Stored edicts whose Bundesland is in scope, removed ones included. */
  known: ReadonlyMap<string, KnownEdict>
  /** Start of the last run with status ok whose scope covered this one. */
  lastOkRunStartedAt: string | null
  /** The same for full runs. */
  lastOkFullRunStartedAt: string | null
  lastFinished: SyncRunSummary | null
}

export interface SyncRunStart {
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
  loadState(scope: readonly Bundesland[]): Awaitable<SyncStoreState>
  /** Records a run with status running and returns its ID. */
  startRun(run: SyncRunStart): Awaitable<number>
  commitRun(commit: SyncCommit): Awaitable<void>
}

export interface SyncOptions {
  source: PageSource
  store: SyncStore
  scope: readonly Bundesland[]
  signal?: AbortSignal
  /** Called during the run and once at its end; must not throw. */
  onProgress?: (status: SyncStatus) => void
  now?: () => Date
  /** List everything even when the last full run was less than a day ago. */
  forceFull?: boolean
}

interface RunContext {
  source: PageSource
  signal: AbortSignal | undefined
  state: SyncStoreState
  scope: Bundesland[]
  kind: RunKind
  startedAt: string
  now: () => Date
  summary: SyncRunSummary
  errors: string[]
  report: (phase: Phase, done: number, total: number) => void
}

interface RunResult {
  upserts: EdictWrite[]
  seenIds: string[]
  unchangedIds: string[]
  removedIds: string[]
  /** Why the run must not write anything; null for a healthy run. */
  degradedNote: string | null
  note: string | null
}

interface ChangedPage {
  row: SearchRow
  detail: ParsedDetail
}

type PageResult<T> = { ok: true; value: T } | { ok: false; gone: boolean }

/**
 * Brings the stored edicts of `scope` up to date. The first run and one run a
 * day list everything; the others list only edicts published since the last
 * good run. Nothing is written unless the run ends ok. Returns the run summary
 * and does not throw for cancelled or failed runs; storage errors propagate.
 */
export async function runSync(options: SyncOptions): Promise<SyncRunSummary> {
  const { source, store, signal, onProgress } = options
  const now = options.now ?? (() => new Date())
  const scope = [...new Set(options.scope)]
  const state = await store.loadState(scope)
  const startedAt = now().toISOString()
  const kind = chooseKind(state, startedAt, options.forceFull === true)
  const summary: SyncRunSummary = {
    id: await store.startRun({ kind, scope, startedAt }),
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
  const requestsAtStart = source.requestCount
  const errors: string[] = []
  const report = (phase: Phase, done: number, total: number): void => {
    summary.requests = source.requestCount - requestsAtStart
    onProgress?.({
      state: signal?.aborted === true ? 'cancelling' : 'running',
      phase,
      done,
      total,
      current: { ...summary },
      lastFinished: state.lastFinished,
    })
  }

  let result: RunResult | null = null
  let failureCode: AppErrorCode | null = null
  try {
    result = await executeRun({
      source,
      signal,
      state,
      scope,
      kind,
      startedAt,
      now,
      summary,
      errors,
      report,
    })
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
  summary.requests = source.requestCount - requestsAtStart
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
  onProgress?.({
    state: 'idle',
    phase: null,
    done: 0,
    total: 0,
    current: null,
    lastFinished: { ...summary },
  })
  return summary
}

function chooseKind(state: SyncStoreState, startedAt: string, forceFull: boolean): RunKind {
  const lastFull = state.lastOkFullRunStartedAt
  if (forceFull || lastFull === null || state.lastOkRunStartedAt === null) return 'full'
  // Only a full run lists, and so reads again, the edicts an older parser read.
  if (hasOutdatedParse(state)) return 'full'
  return Date.parse(startedAt) - Date.parse(lastFull) >= FULL_SYNC_INTERVAL_MS
    ? 'full'
    : 'incremental'
}

function hasOutdatedParse(state: SyncStoreState): boolean {
  for (const edict of state.known.values()) {
    if (edict.removedAt === null && edict.parserVersion < PARSER_VERSION) return true
  }
  return false
}

async function executeRun(run: RunContext): Promise<RunResult> {
  const listing = await listRows(run)
  const known = run.state.known
  const toFetch: SearchRow[] = []
  const seenIds: string[] = []
  for (const row of listing.rows.values()) {
    if (needsPage(run, row, known.get(row.id))) toFetch.push(row)
    else seenIds.push(row.id)
  }

  const samples: HealthSample[] = []
  const changed: ChangedPage[] = []
  const unchangedIds: string[] = []
  let failed = 0
  let gone = 0
  for (const [index, row] of toFetch.entries()) {
    run.report('details', index, toFetch.length)
    const page = await readPage(run, row.id, async () =>
      parseDetailPage(await run.source.getText(row.url, run.signal)),
    )
    if (!page.ok) {
      if (page.gone) gone += 1
      else failed += 1
      continue
    }
    const detail = page.value
    run.summary.fetched += 1
    // An unknown heading is logged so new notice types get noticed; the list
    // row then says which kind of notice the page is.
    const unknownNotice = detail.noticeType === 'other'
    if (unknownNotice) run.errors.push(`${row.id}: unknown notice "${detail.noticeText}"`)
    samples.push({
      noticeType: unknownNotice ? row.noticeType : detail.noticeType,
      unknownNotice,
      caseNumber: detail.fields.caseNumber,
      schaetzwertEur: detail.fields.schaetzwertEur,
    })
    const before = known.get(row.id)
    if (before !== undefined && isUnchanged(before, detail)) unchangedIds.push(row.id)
    else changed.push({ row, detail })
  }
  run.report('details', toFetch.length, toFetch.length)

  const upserts = await readKurzgutachtenPages(run, changed)
  throwIfCancelled(run.signal)

  const problems: string[] = []
  const health = assessRunHealth(samples)
  if (health.note !== null) problems.push(health.note)
  const attempted = toFetch.length - gone
  if (exceedsShare(failed, attempted, FAILED_PAGE_LIMIT)) {
    problems.push(`${failed} of ${attempted} edict pages could not be read`)
  }
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
    if (removedIds.length > MASS_REMOVAL_MIN && removedIds.length > active.length / 2) {
      problems.push(`The list would remove ${removedIds.length} of ${active.length} edicts`)
    }
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

/**
 * Lists the edicts of every Bundesland in scope. `incomplete` says why the list
 * may lack edicts that still exist: the site cut it off, or rows were unreadable.
 */
async function listRows(
  run: RunContext,
): Promise<{ rows: Map<string, SearchRow>; incomplete: string | null }> {
  const since = run.kind === 'incremental' ? incrementalSince(run.state) : undefined
  const rows = new Map<string, SearchRow>()
  let cutOff = false
  let skipped = 0
  for (const [index, bundesland] of run.scope.entries()) {
    run.report('list', index, run.scope.length)
    const url = buildSearchUrl({ bundesland, publishedSince: since })
    const result = parseSearchResults(await run.source.getText(url, run.signal), bundesland)
    if (result.totalHits > result.rows.length + result.skipped.length) cutOff = true
    skipped += result.skipped.length
    for (const message of result.skipped) run.errors.push(`List ${bundesland}: ${message}`)
    for (const row of result.rows) rows.set(row.id, row)
  }
  run.summary.listed = rows.size
  run.report('list', run.scope.length, run.scope.length)
  let incomplete: string | null = null
  if (cutOff) incomplete = `The site list stops at ${SEARCH_MAX} entries`
  else if (skipped > 0) incomplete = `${skipped} list rows could not be read`
  return { rows, incomplete }
}

/** Full runs skip pages that cannot have changed; incremental runs read every listed page. */
function needsPage(run: RunContext, row: SearchRow, known: KnownEdict | undefined): boolean {
  if (run.kind === 'incremental' || known === undefined) return true
  return (
    known.removedAt !== null ||
    known.contentHash === '' ||
    known.parserVersion < PARSER_VERSION ||
    known.noticeType !== row.noticeType ||
    (row.eventDate !== null &&
      known.auctionAt !== null &&
      !known.auctionAt.startsWith(row.eventDate)) ||
    Date.parse(run.startedAt) - Date.parse(known.fetchedAt) >= REFRESH_AFTER_MS
  )
}

function isUnchanged(known: KnownEdict, detail: ParsedDetail): boolean {
  return (
    known.contentHash === detail.contentHash &&
    known.parserVersion === PARSER_VERSION &&
    known.removedAt === null
  )
}

async function readKurzgutachtenPages(
  run: RunContext,
  changed: readonly ChangedPage[],
): Promise<EdictWrite[]> {
  const total = changed.filter(({ detail }) => detail.kurzgutachtenUrl !== null).length
  const fetchedAt = run.now().toISOString()
  const writes: EdictWrite[] = []
  let done = 0
  for (const { row, detail } of changed) {
    let kurzgutachten: KurzgutachtenFacts | null = null
    let complete = true
    const url = detail.kurzgutachtenUrl
    if (url !== null) {
      run.report('kurzgutachten', done, total)
      done += 1
      const page = await readPage(run, row.id, async () =>
        parseKurzgutachten(await run.source.getText(url, run.signal)),
      )
      if (page.ok) kurzgutachten = page.value
      else complete = page.gone
    }
    const edict = buildEdictRecord({ id: row.id, detail, row, kurzgutachten, fetchedAt })
    // An empty hash makes the next run read the page, and the missing Kurzgutachten, again.
    writes.push({
      edict: complete ? edict : { ...edict, contentHash: '' },
      documents: detail.documents,
    })
  }
  if (total > 0) run.report('kurzgutachten', total, total)
  return writes
}

/**
 * Reads one page. Errors that concern only this page are logged and skipped;
 * cancellation and a site that is down or blocking end the run.
 */
async function readPage<T>(
  run: RunContext,
  id: string,
  read: () => Promise<T>,
): Promise<PageResult<T>> {
  throwIfCancelled(run.signal)
  try {
    return { ok: true, value: await read() }
  } catch (error) {
    const failure = toAppError(error)
    if (['cancelled', 'site_unavailable', 'rate_limited'].includes(failure.code)) throw failure
    run.errors.push(`${id}: ${failure.code}: ${failure.message}`)
    return { ok: false, gone: failure.code === 'not_found' }
  }
}

const VIENNA_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Publication date for an incremental list: the day before the last good run, in Vienna. */
function incrementalSince(state: SyncStoreState): string | undefined {
  if (state.lastOkRunStartedAt === null) return undefined
  const parts = VIENNA_DAY.formatToParts(new Date(Date.parse(state.lastOkRunStartedAt) - DAY_MS))
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new AppError('cancelled', 'Cancelled')
}

function toAppError(error: unknown): AppError {
  return isAppError(error)
    ? error
    : new AppError('internal', 'Unexpected error during sync', { cause: error })
}
