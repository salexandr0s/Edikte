import { describe, expect, it } from 'vitest'
import type { ListingQuery, ListingRow } from '@shared/domain'
import {
  analyzableIds,
  applyPatch,
  applyUserStatePatches,
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

  it('keeps a change over refetched pages until a page arrives after its save', () => {
    const inFlight = replay([sent(1, { starred: true }), { kind: 'page' }])
    expect(pendingPatches(inFlight).get('case-a')).toEqual({ starred: true })
    const saved = nextPendingUserState(inFlight, { kind: 'saved', id: 1 })
    expect(pendingPatches(saved).get('case-a')).toEqual({ starred: true })
    expect(nextPendingUserState(saved, { kind: 'page' })).toEqual([])
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
