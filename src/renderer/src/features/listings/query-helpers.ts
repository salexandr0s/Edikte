import {
  ListingQuerySchema,
  type AnalysisProgress,
  type ListingQuery,
  type ListingRow,
} from '@shared/domain'
import type {
  AnalysisStatus,
  Bundesland,
  EdictSource,
  ListingStatus,
  PriceBasis,
  PropertyType,
  RiskLevel,
} from '@shared/enums'
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

/** Clears filters while keeping the source view and sort order. */
export function resetFilters(query: ListingQuery, priceBasis: PriceBasis): ListingQuery {
  return { ...defaultQuery(priceBasis), sources: query.sources, sort: query.sort }
}

/** Sales have a publication date rather than an auction date. */
export function selectSources(query: ListingQuery, sources: EdictSource[]): ListingQuery {
  const next = applyPatch(query, { sources })
  if (!insolvencyOnly(next)) return next
  return applyPatch(next, {
    auctionFrom: null,
    auctionTo: null,
    sort:
      next.sort.column === 'auctionAt' ? { column: 'publishedAt', direction: 'desc' } : next.sort,
  })
}

export function insolvencyOnly(query: Pick<ListingQuery, 'sources'>): boolean {
  return query.sources.length === 1 && query.sources[0] === 'insolvency_sale'
}

/** A saved filter can select a source that has since been disabled. */
export function selectsDisabledSources(
  query: Pick<ListingQuery, 'sources'>,
  enabled: readonly EdictSource[],
): boolean {
  return query.sources.length > 0 && query.sources.every((source) => !enabled.includes(source))
}

/** A hidden source switch must not keep selecting a disabled source. */
export function forEnabledSources(
  query: ListingQuery,
  enabled: readonly EdictSource[],
): ListingQuery {
  const [source] = enabled
  if (enabled.length === 1 && source !== undefined) {
    return selectSources(
      query,
      query.sources.length === 1 && query.sources[0] === source ? query.sources : [source],
    )
  }
  return selectSources(query, query.sources)
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

export type ActiveFilter =
  | { key: 'text'; text: string }
  | { key: 'price'; min: number | null; max: number | null }
  | { key: 'maxPricePerSqm'; value: number }
  | { key: 'includeWithoutArea' }
  | { key: 'area'; min: number | null; max: number | null }
  | { key: 'bundeslaender'; values: readonly Bundesland[] }
  | { key: 'bezirke'; values: readonly number[] }
  | { key: 'propertyTypes'; values: readonly PropertyType[] }
  | { key: 'statuses'; values: readonly ListingStatus[] }
  | { key: 'auctionDate'; from: string | null; to: string | null }
  | { key: 'riskLevels'; values: readonly RiskLevel[] }
  | { key: 'analyzedOnly' }
  | { key: 'starredOnly' }
  | { key: 'showHidden' }

export type ActiveFilterKey = ActiveFilter['key']

/**
 * The filters that differ from the defaults, in the order of the filter
 * dialog. Price basis and sort order are not filters.
 */
export function activeFilters(query: ListingQuery): ActiveFilter[] {
  const filters: ActiveFilter[] = []
  const text = query.text.trim()
  if (text !== '') filters.push({ key: 'text', text })
  if (query.minPrice !== null || query.maxPrice !== null) {
    filters.push({ key: 'price', min: query.minPrice, max: query.maxPrice })
  }
  if (query.maxPricePerSqm !== null) {
    filters.push({ key: 'maxPricePerSqm', value: query.maxPricePerSqm })
  }
  if (query.includeWithoutArea) filters.push({ key: 'includeWithoutArea' })
  if (query.minArea !== null || query.maxArea !== null) {
    filters.push({ key: 'area', min: query.minArea, max: query.maxArea })
  }
  if (query.bundeslaender.length > 0) {
    filters.push({ key: 'bundeslaender', values: query.bundeslaender })
  }
  if (query.bezirke.length > 0) filters.push({ key: 'bezirke', values: query.bezirke })
  if (query.propertyTypes.length > 0) {
    filters.push({ key: 'propertyTypes', values: query.propertyTypes })
  }
  if (statusesChanged(query.statuses)) filters.push({ key: 'statuses', values: query.statuses })
  if (query.auctionFrom !== null || query.auctionTo !== null) {
    filters.push({ key: 'auctionDate', from: query.auctionFrom, to: query.auctionTo })
  }
  if (query.riskLevels.length > 0) filters.push({ key: 'riskLevels', values: query.riskLevels })
  if (query.analyzedOnly) filters.push({ key: 'analyzedOnly' })
  if (query.starredOnly) filters.push({ key: 'starredOnly' })
  if (query.showHidden) filters.push({ key: 'showHidden' })
  return filters
}

function statusesChanged(statuses: readonly ListingStatus[]): boolean {
  return (
    statuses.length !== DEFAULT_STATUSES.length ||
    DEFAULT_STATUSES.some((status) => !statuses.includes(status))
  )
}

/** The change that takes one filter back to its default. */
export function clearFilter(key: ActiveFilterKey): Partial<ListingQuery> {
  switch (key) {
    case 'text':
      return { text: '' }
    case 'price':
      return { minPrice: null, maxPrice: null }
    case 'maxPricePerSqm':
      return { maxPricePerSqm: null }
    case 'includeWithoutArea':
      return { includeWithoutArea: false }
    case 'area':
      return { minArea: null, maxArea: null }
    case 'bundeslaender':
      return { bundeslaender: [] }
    case 'bezirke':
      return { bezirke: [] }
    case 'propertyTypes':
      return { propertyTypes: [] }
    case 'statuses':
      return { statuses: DEFAULT_STATUSES }
    case 'auctionDate':
      return { auctionFrom: null, auctionTo: null }
    case 'riskLevels':
      return { riskLevels: [] }
    case 'analyzedOnly':
      return { analyzedOnly: false }
    case 'starredOnly':
      return { starredOnly: false }
    case 'showHidden':
      return { showHidden: false }
  }
}

/** How many filters differ from the defaults. */
export function countActiveFilters(query: ListingQuery): number {
  return activeFilters(query).length
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

/** Shown listings without a current finished analysis or a pending job. */
export function analyzableIds(rows: readonly ListingRow[], tracker: AnalysisTracker): string[] {
  return rows
    .filter((row) => {
      const status = currentAnalysisStatus(row, tracker)
      if (status === 'done' && row.analysisStale) return true
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
