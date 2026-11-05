import {
  ListingQuerySchema,
  type AnalysisProgress,
  type ListingQuery,
  type ListingRow,
} from '@shared/domain'
import type { AnalysisStatus, Bundesland, PriceBasis } from '@shared/enums'
import { parseGermanNumber } from '@shared/parse-numbers'

// Pure helpers for the listings screen. No React and no DOM, so the unit
// tests can import this module in Node.

export type ListingSort = ListingQuery['sort']
export type SortColumn = ListingSort['column']

const QUERY_KEYS = ListingQuerySchema.keyof().options
const DEFAULT_STATUSES = ListingQuerySchema.parse({}).statuses

export function defaultQuery(priceBasis: PriceBasis): ListingQuery {
  return ListingQuerySchema.parse({ priceBasis })
}

/** Clears every filter. The sort order stays, because it is not a filter. */
export function resetFilters(query: ListingQuery, priceBasis: PriceBasis): ListingQuery {
  return { ...defaultQuery(priceBasis), sort: query.sort }
}

/**
 * Merges a change into the query. Returns the same object when nothing
 * changed, so React skips the render and no new request goes out.
 */
export function applyPatch(query: ListingQuery, patch: Partial<ListingQuery>): ListingQuery {
  const changed = QUERY_KEYS.some((key) => key in patch && patch[key] !== query[key])
  return changed ? { ...query, ...patch } : query
}

/** Fields the user types into: the search text and the number filters. */
const TYPED_KEYS: ReadonlySet<keyof ListingQuery> = new Set<keyof ListingQuery>([
  'text',
  'minPrice',
  'maxPrice',
  'minArea',
  'maxArea',
  'maxPricePerSqm',
])

/**
 * True when something changed and all of it was typed. Query updates spread
 * the previous query, so every other field keeps its identity and a shallow
 * compare works.
 */
export function onlyTypedFieldsChanged(previous: ListingQuery, next: ListingQuery): boolean {
  const changed = QUERY_KEYS.filter((key) => previous[key] !== next[key])
  return changed.length > 0 && changed.every((key) => TYPED_KEYS.has(key))
}

/** Vienna's districts are offered while Vienna or no Bundesland is selected. */
export function showsBezirke(bundeslaender: readonly Bundesland[]): boolean {
  return bundeslaender.length === 0 || bundeslaender.includes('wien')
}

/** Filters that differ from the defaults. Price basis and sort order are not filters. */
export function countActiveFilters(query: ListingQuery): number {
  const statusesChanged =
    query.statuses.length !== DEFAULT_STATUSES.length ||
    DEFAULT_STATUSES.some((status) => !query.statuses.includes(status))
  return [
    query.bundeslaender.length > 0,
    query.bezirke.length > 0,
    query.propertyTypes.length > 0,
    statusesChanged,
    query.maxPricePerSqm !== null,
    query.minArea !== null || query.maxArea !== null,
    query.minPrice !== null || query.maxPrice !== null,
    query.auctionFrom !== null || query.auctionTo !== null,
    query.riskLevels.length > 0,
    query.analyzedOnly,
    query.includeWithoutArea,
    query.starredOnly,
    query.showHidden,
    query.text.trim() !== '',
  ].filter(Boolean).length
}

/** The direction a column starts with: soonest, cheapest, largest, newest first. */
const FIRST_DIRECTION: Readonly<Record<SortColumn, ListingSort['direction']>> = {
  auctionAt: 'asc',
  publishedAt: 'desc',
  pricePerSqm: 'asc',
  price: 'asc',
  area: 'desc',
  bezirk: 'asc',
}

/** Clicking the active column flips the direction; another column starts fresh. */
export function nextSort(sort: ListingSort, column: SortColumn): ListingSort {
  if (sort.column === column) {
    return { column, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { column, direction: FIRST_DIRECTION[column] }
}

export type WholeNumberInput =
  { status: 'empty' } | { status: 'valid'; value: number } | { status: 'invalid' }

/**
 * Reads a non-negative whole number as typed in the UI language: "5.000" and
 * "5000" everywhere, "5,000" as five thousand in English.
 */
export function parseWholeNumber(text: string, language: string): WholeNumberInput {
  const trimmed = text.trim()
  if (trimmed === '') return { status: 'empty' }
  // parseGermanNumber reads a single comma as a decimal comma.
  const englishThousands = language === 'en' && /^\d{1,3}(?:,\d{3})+$/.test(trimmed)
  const value = parseGermanNumber(englishThousands ? trimmed.replaceAll(',', '') : trimmed)
  if (value === null || !Number.isSafeInteger(value) || value < 0) return { status: 'invalid' }
  return { status: 'valid', value }
}

// ── Analyses ───────────────────────────────────────────────────────────────

export interface AnalysisTracker {
  /** Latest status per edict ID from analysis:progress events. */
  readonly statuses: ReadonlyMap<string, AnalysisStatus>
  /** Jobs waiting in the queue, as of the latest event. */
  readonly waiting: number
}

export const EMPTY_TRACKER: AnalysisTracker = { statuses: new Map(), waiting: 0 }

export function trackAnalysis(tracker: AnalysisTracker, event: AnalysisProgress): AnalysisTracker {
  const statuses = new Map(tracker.statuses)
  statuses.set(event.edictId, event.status)
  return { statuses, waiting: event.queued }
}

/** An event is newer than the row, which only changes after a refetch. */
export function currentAnalysisStatus(
  row: ListingRow,
  tracker: AnalysisTracker,
): AnalysisStatus | null {
  return tracker.statuses.get(row.id) ?? row.analysisStatus
}

/** Running and waiting analyses, from the shown rows and from every event. */
export function queueCounts(
  rows: readonly ListingRow[],
  tracker: AnalysisTracker,
): { running: number; waiting: number } {
  const statuses = new Map<string, AnalysisStatus | null>(
    rows.map((row) => [row.id, row.analysisStatus]),
  )
  for (const [edictId, status] of tracker.statuses) statuses.set(edictId, status)
  let running = 0
  let queued = 0
  for (const status of statuses.values()) {
    if (status === 'running') running += 1
    else if (status === 'queued') queued += 1
  }
  return { running, waiting: Math.max(queued, tracker.waiting) }
}

const NOT_ANALYZABLE: ReadonlySet<AnalysisStatus> = new Set(['done', 'queued', 'running'])

/** Shown listings without a finished, queued or running analysis. */
export function analyzableIds(rows: readonly ListingRow[], tracker: AnalysisTracker): string[] {
  return rows
    .filter((row) => {
      const status = currentAnalysisStatus(row, tracker)
      return status === null || !NOT_ANALYZABLE.has(status)
    })
    .map((row) => row.id)
}

// ── Star and hide ──────────────────────────────────────────────────────────

export interface UserStatePatch {
  starred?: boolean
  hidden?: boolean
}

/**
 * Applies star and hide changes that main has not confirmed with a refetch
 * yet. Patches are keyed by case, like the stored user state.
 */
export function applyUserStatePatches(
  rows: ListingRow[],
  patches: ReadonlyMap<string, UserStatePatch>,
  query: Pick<ListingQuery, 'showHidden' | 'starredOnly'>,
): ListingRow[] {
  if (patches.size === 0) return rows
  return rows.flatMap((row) => {
    const patch = patches.get(row.caseKey)
    if (patch === undefined) return [row]
    const next = { ...row, ...patch }
    if (next.hidden && !query.showHidden) return []
    if (query.starredOnly && !next.starred) return []
    return [next]
  })
}

/** A star or hide change, from the click until a page that contains it. */
export interface PendingUserState {
  id: number
  caseKey: string
  patch: UserStatePatch
  /**
   * Set once main has stored the change: the number of list queries sent by
   * then. Only a page from a later query is sure to contain the change.
   */
  savedAfterRequest: number | null
}

export type UserStateEvent =
  | { kind: 'sent'; id: number; caseKey: string; patch: UserStatePatch }
  | { kind: 'saved'; id: number; requestsSent: number }
  | { kind: 'failed'; id: number }
  /** A refetched page arrived, the answer to list query number `request`. */
  | { kind: 'page'; request: number }

/**
 * Keeps star and hide changes until a refetch confirms them. A change stays
 * on top of every page that arrives while its request is in flight, and ends
 * with the first page from a query sent after main stored it. A failed
 * request takes back only its own change.
 */
export function nextPendingUserState(
  changes: readonly PendingUserState[],
  event: UserStateEvent,
): readonly PendingUserState[] {
  switch (event.kind) {
    case 'sent':
      return [
        ...changes,
        { id: event.id, caseKey: event.caseKey, patch: event.patch, savedAfterRequest: null },
      ]
    case 'saved':
      return changes.map((change) =>
        change.id === event.id ? { ...change, savedAfterRequest: event.requestsSent } : change,
      )
    case 'failed':
      return changes.filter((change) => change.id !== event.id)
    case 'page': {
      const open = changes.filter(
        (change) => change.savedAfterRequest === null || event.request <= change.savedAfterRequest,
      )
      return open.length === changes.length ? changes : open
    }
  }
}

/** The pending changes per case, later changes over earlier ones. */
export function pendingPatches(
  changes: readonly PendingUserState[],
): ReadonlyMap<string, UserStatePatch> {
  const byCase = new Map<string, UserStatePatch>()
  for (const change of changes) {
    byCase.set(change.caseKey, { ...byCase.get(change.caseKey), ...change.patch })
  }
  return byCase
}
