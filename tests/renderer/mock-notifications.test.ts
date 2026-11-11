import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, ListingQuerySchema, type ListingRow } from '@shared/domain'
import {
  CollectionPageSchema,
  DashboardDataSchema,
  NotificationDetailSchema,
} from '@shared/notifications'
import type { Emit, MockState } from '../../src/renderer/src/dev/mock-core'
import { createMockNotificationHandlers } from '../../src/renderer/src/dev/mock-notifications'

const NOW = new Date('2026-11-11T08:00:00.000Z')

function row(n: number, overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: n.toString(16).padStart(32, '0'),
    source: 'court_auction',
    caseKey: `mock-${n}`,
    url: 'https://example.at/property',
    status: 'upcoming',
    noticeType: 'versteigerung',
    title: `Wohnung ${n}`,
    categoryLabel: null,
    propertyType: 'apartment',
    street: null,
    plz: null,
    city: 'Wien',
    bundesland: 'wien',
    bezirk: null,
    location: null,
    court: null,
    caseNumber: null,
    auctionAt: '2026-11-13T10:00',
    publishedAt: '2026-11-10',
    schaetzwertEur: 200_000,
    geringstesGebotEur: 100_000,
    area: {
      sqm: 50,
      kind: 'nutzflaeche',
      source: 'listing',
      page: null,
      quote: null,
      documentId: null,
    },
    plotSqm: null,
    priceBasis: 'schaetzwert',
    pricePerSqm: 4000,
    approximate: [],
    analysisStatus: null,
    hasAnalysis: false,
    analysisStale: false,
    riskLevel: null,
    hasLanggutachten: false,
    starred: false,
    hidden: false,
    removedAt: null,
    ...overrides,
  }
}

function setup() {
  const state: MockState = {
    settings: structuredClone(DEFAULT_SETTINGS),
    rows: [
      row(1, { starred: true }),
      row(2, { schaetzwertEur: 300_000, geringstesGebotEur: 150_000 }),
      row(3, {
        source: 'insolvency_sale',
        id: 'mv-3',
        status: 'on_offer',
        noticeType: 'insolvenzverkauf',
        auctionAt: null,
        geringstesGebotEur: null,
      }),
      row(4, { bundesland: 'noe' }),
    ],
    filters: [
      {
        id: 1,
        name: 'Wohnungen bis 5.000 €/m²',
        presetKey: null,
        query: ListingQuerySchema.parse({ maxPricePerSqm: 5000 }),
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
      {
        id: 2,
        name: 'Mindestgebot bis 5.000 €/m²',
        presetKey: null,
        query: ListingQuerySchema.parse({
          sources: ['court_auction'],
          maxPricePerSqm: 5000,
          priceBasis: 'geringstes_gebot',
        }),
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    ],
    userState: new Map(),
    providers: [],
    documents: [],
    estimates: [],
    analyses: [],
    sync: { state: 'idle', phase: null, done: 0, total: 0, current: null, lastRuns: [] },
  }
  const events: string[] = []
  const emit: Emit = (event) => {
    events.push(event)
  }
  const mock = createMockNotificationHandlers(
    state,
    emit,
    () => state.rows,
    () => NOW,
  )
  return { state, events, ...mock }
}

describe('notification browser mock', () => {
  it('keeps union counts and drill-down membership aligned within the sync scope', () => {
    const { handlers, state, reconcileFilters } = setup()
    const dashboard = DashboardDataSchema.parse(handlers['dashboard:get']({ filterId: null }))
    const collection = CollectionPageSchema.parse(
      handlers['listings:queryCollection']({
        kind: 'saved_searches',
        filterId: null,
        section: 'all',
      }),
    )
    expect(dashboard.counts).toEqual({ matching: 3, new: 3, upcoming: 2, starred: 1 })
    expect(collection.total).toBe(dashboard.counts.matching)
    expect(collection.items.find((item) => item.listing.caseKey === 'mock-1')?.filterIds).toEqual([
      1, 2,
    ])
    expect(dashboard.searches.map((search) => search.matchCount)).toEqual([2, 2])

    state.settings.syncSources = ['insolvency_sale']
    reconcileFilters(true)
    const selected = DashboardDataSchema.parse(handlers['dashboard:get']({ filterId: 2 }))
    expect(selected.counts.matching).toBe(0)
    expect(selected.searches.find((search) => search.filter.id === 2)?.inScope).toBe(false)
  })

  it('preserves digest snapshots after listing changes and saved-filter deletion', () => {
    const { handlers, state, events, reconcileFilters } = setup()
    const original = NotificationDetailSchema.parse(handlers['notifications:get']({ id: 1 }))
    const first = state.rows[0]
    if (first === undefined) throw new Error('Missing fixture')
    first.schaetzwertEur = 900_000
    first.removedAt = NOW.toISOString()
    state.filters = state.filters.filter((filter) => filter.id !== 1)
    reconcileFilters()
    const historical = NotificationDetailSchema.parse(handlers['notifications:get']({ id: 1 }))
    expect(historical.notification.count).toBe(original.notification.count)
    expect(historical.notification.filterId).toBeNull()
    expect(historical.notification.filterName).toBe(original.notification.filterName)
    expect(historical.items.map((item) => item.listing)).toEqual(
      original.items.map((item) => item.listing),
    )
    expect(historical.items[0]?.current?.removedAt).toBe(NOW.toISOString())
    handlers['notifications:markAllRead']()
    expect(handlers['notifications:list']({ unreadOnly: true, limit: 25 }).unreadCount).toBe(0)
    expect(events).toContain('filters:changed')
    expect(events).toContain('notifications:changed')
  })
})
