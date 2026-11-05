import { describe, expect, it } from 'vitest'
import type { ListingQuery, ListingRow } from '@shared/domain'
import {
  activeFilters,
  analyzableIds,
  applyPatch,
  applyUserStatePatches,
  clearFilter,
  countActiveFilters,
  defaultQuery,
  EMPTY_TRACKER,
  nextPendingUserState,
  nextSort,
  onlyTypedFieldsChanged,
  parseWholeNumber,
  pendingPatches,
  queueCounts,
  trackAnalysis,
  type PendingUserState,
  type UserStateEvent,
  type UserStatePatch,
} from '../../../src/renderer/src/features/listings/query-helpers'

function row(id: string, analysisStatus: ListingRow['analysisStatus']): ListingRow {
  return {
    id,
    caseKey: `case-${id}`,
    url: `https://edikte.justiz.gv.at/${id}`,
    status: 'upcoming',
    noticeType: 'versteigerung',
    title: `Listing ${id}`,
    categoryLabel: null,
    propertyType: 'apartment',
    street: null,
    plz: null,
    city: null,
    bundesland: 'wien',
    bezirk: null,
    location: null,
    court: null,
    caseNumber: null,
    auctionAt: null,
    publishedAt: null,
    schaetzwertEur: null,
    geringstesGebotEur: null,
    area: null,
    plotSqm: null,
    priceBasis: 'schaetzwert',
    pricePerSqm: null,
    approximate: [],
    analysisStatus,
    hasAnalysis: false,
    riskLevel: null,
    hasLanggutachten: true,
    starred: false,
    hidden: false,
    removedAt: null,
  }
}

describe('parseWholeNumber', () => {
  it('reads thousands separators in both UI languages', () => {
    expect(parseWholeNumber('5.000', 'de')).toEqual({ status: 'valid', value: 5000 })
    expect(parseWholeNumber(' 5000 ', 'de')).toEqual({ status: 'valid', value: 5000 })
    expect(parseWholeNumber('5,000', 'en')).toEqual({ status: 'valid', value: 5000 })
    expect(parseWholeNumber('', 'en')).toEqual({ status: 'empty' })
  })

  it('rejects decimals, negative numbers and text', () => {
    for (const text of ['4.861,50', '5,5', '-3', '12a', '1e5']) {
      expect(parseWholeNumber(text, 'de').status, text).toBe('invalid')
    }
    expect(parseWholeNumber('4,861.50', 'en').status).toBe('invalid')
  })
})

describe('query updates', () => {
  it('debounces changes of the search text and the number filters only', () => {
    const query = defaultQuery('schaetzwert')
    const typed = (patch: Partial<ListingQuery>) =>
      onlyTypedFieldsChanged(query, applyPatch(query, patch))
    expect(typed({ text: 'Favoriten' })).toBe(true)
    expect(typed({ minPrice: 50_000, maxPricePerSqm: 4_000 })).toBe(true)
    expect(typed({ text: 'x', starredOnly: true })).toBe(false)
    expect(typed({})).toBe(false)
    expect(onlyTypedFieldsChanged(query, defaultQuery('schaetzwert'))).toBe(false)
  })

  it('keeps the same query object when a patch changes nothing', () => {
    const query = defaultQuery('schaetzwert')
    expect(applyPatch(query, { maxPricePerSqm: null, priceBasis: 'schaetzwert' })).toBe(query)
  })

  it('flips the active sort column and starts others in their natural direction', () => {
    const sort = { column: 'pricePerSqm', direction: 'asc' } as const
    expect(nextSort(sort, 'pricePerSqm')).toEqual({ column: 'pricePerSqm', direction: 'desc' })
    expect(nextSort(sort, 'area')).toEqual({ column: 'area', direction: 'desc' })
  })
})

describe('analysis queue', () => {
  it('prefers events over older rows and counts jobs outside the filter', () => {
    const rows = [row('a', 'running'), row('b', 'queued'), row('c', null), row('d', 'failed')]
    const finished = trackAnalysis(EMPTY_TRACKER, {
      analysisId: 1,
      edictId: 'a',
      status: 'done',
      step: null,
      queued: 2,
    })
    const tracker = trackAnalysis(finished, {
      analysisId: 2,
      edictId: 'b',
      status: 'running',
      step: 'asking',
      queued: 2,
    })
    expect(queueCounts(rows, tracker)).toEqual({ running: 1, waiting: 2 })
    expect(analyzableIds(rows, tracker)).toEqual(['c', 'd'])
  })
})

describe('applyUserStatePatches', () => {
  it('drops a row hidden in this session unless hidden rows are shown', () => {
    const rows = [row('a', null), row('b', null)]
    const patches = new Map([['case-a', { hidden: true }]])
    const visible = applyUserStatePatches(rows, patches, { showHidden: false, starredOnly: false })
    expect(visible.map((candidate) => candidate.id)).toEqual(['b'])
    const all = applyUserStatePatches(rows, patches, { showHidden: true, starredOnly: false })
    expect(all[0]?.hidden).toBe(true)
  })
})

describe('pending star and hide changes', () => {
  const sent = (id: number, patch: UserStatePatch): UserStateEvent => ({
    kind: 'sent',
    id,
    caseKey: 'case-a',
    patch,
  })
  const replay = (events: UserStateEvent[]) =>
    events.reduce<readonly PendingUserState[]>(
      (changes, event) => nextPendingUserState(changes, event),
      [],
    )

  it('keeps a change until the page of a query sent after its save arrives', () => {
    const inFlight = replay([sent(1, { starred: true }), { kind: 'page', request: 1 }])
    expect(pendingPatches(inFlight).get('case-a')).toEqual({ starred: true })
    // Query 2 was sent before the save, so its page may lack the change.
    const saved = nextPendingUserState(inFlight, { kind: 'saved', id: 1, requestsSent: 2 })
    const stale = nextPendingUserState(saved, { kind: 'page', request: 2 })
    expect(pendingPatches(stale).get('case-a')).toEqual({ starred: true })
    expect(nextPendingUserState(stale, { kind: 'page', request: 3 })).toEqual([])
  })

  it('takes back only the change whose request failed', () => {
    const changes = replay([
      sent(1, { starred: true }),
      sent(2, { hidden: true }),
      sent(3, { starred: false }),
      { kind: 'failed', id: 3 },
    ])
    expect(pendingPatches(changes).get('case-a')).toEqual({ starred: true, hidden: true })
  })
})

describe('active filters', () => {
  const base = defaultQuery('schaetzwert')
  const patches: Partial<ListingQuery>[] = [
    { text: ' Favoriten ' },
    { minPrice: 100_000 },
    { maxPricePerSqm: 4_000 },
    { includeWithoutArea: true },
    { maxArea: 120 },
    { bundeslaender: ['wien'] },
    { bezirke: [3, 22] },
    { propertyTypes: ['apartment'] },
    { statuses: ['sold'] },
    { auctionTo: '2027-03-31' },
    { riskLevels: ['high'] },
    { analyzedOnly: true },
    { starredOnly: true },
    { showHidden: true },
  ]
  const all = patches.reduce<ListingQuery>((query, patch) => applyPatch(query, patch), base)

  it('lists one entry per changed filter, in the order of the dialog', () => {
    expect(activeFilters(base)).toEqual([])
    expect(activeFilters(all).map((filter) => filter.key)).toEqual([
      'text',
      'price',
      'maxPricePerSqm',
      'includeWithoutArea',
      'area',
      'bundeslaender',
      'bezirke',
      'propertyTypes',
      'statuses',
      'auctionDate',
      'riskLevels',
      'analyzedOnly',
      'starredOnly',
      'showHidden',
    ])
    expect(activeFilters(all)[0]).toEqual({ key: 'text', text: 'Favoriten' })
    expect(countActiveFilters(all)).toBe(patches.length)
  })

  it('counts neither the price basis nor the default statuses in any order', () => {
    const same = applyPatch(base, {
      statuses: ['postponed', 'upcoming'],
      priceBasis: 'geringstes_gebot',
    })
    expect(activeFilters(same)).toEqual([])
    expect(activeFilters(applyPatch(base, { statuses: [] }))).toEqual([
      { key: 'statuses', values: [] },
    ])
  })

  it('clears each filter on its own', () => {
    for (const filter of activeFilters(all)) {
      const cleared = applyPatch(all, clearFilter(filter.key))
      expect(activeFilters(cleared).map((entry) => entry.key)).not.toContain(filter.key)
      expect(countActiveFilters(cleared)).toBe(patches.length - 1)
    }
  })
})
