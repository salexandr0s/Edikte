import { describe, expect, it } from 'vitest'
import {
  ListingQuerySchema,
  PRESET_WIEN_UNDER_5000,
  type AreaValue,
  type ListingQueryInput,
  type ListingRow,
} from '@shared/domain'
import { applyListingQuery } from '@shared/listing-query'

function area(sqm: number, kind: AreaValue['kind'] = 'nutzflaeche'): AreaValue {
  return { sqm, kind, source: 'listing', page: null, quote: null, documentId: null }
}

function row(name: string, fields: Partial<ListingRow> = {}): ListingRow {
  return {
    id: name,
    source: 'court_auction',
    caseKey: `case-${name}`,
    url: 'https://edikte.justiz.gv.at/',
    status: 'upcoming',
    noticeType: 'versteigerung',
    title: 'Eigentumswohnung',
    categoryLabel: null,
    propertyType: 'apartment',
    street: null,
    plz: '1220',
    city: 'Wien',
    bundesland: 'wien',
    bezirk: 22,
    location: null,
    court: null,
    caseNumber: null,
    auctionAt: '2026-12-01T10:00',
    publishedAt: null,
    schaetzwertEur: 200_000,
    geringstesGebotEur: 100_000,
    area: area(50),
    plotSqm: null,
    priceBasis: 'schaetzwert',
    pricePerSqm: null,
    approximate: [],
    analysisStatus: null,
    hasAnalysis: false,
    analysisStale: false,
    riskLevel: null,
    hasLanggutachten: true,
    starred: false,
    hidden: false,
    removedAt: null,
    ...fields,
  }
}

/** A sale in insolvency proceedings: on offer, without an auction date or a minimum bid. */
function sale(name: string, fields: Partial<ListingRow> = {}): ListingRow {
  return row(name, {
    source: 'insolvency_sale',
    status: 'on_offer',
    noticeType: 'insolvenzverkauf',
    auctionAt: null,
    geringstesGebotEur: null,
    ...fields,
  })
}

const rows = [
  row('apartment-4000'),
  row('apartment-6000', { schaetzwertEur: 300_000, geringstesGebotEur: 150_000 }),
  row('apartment-no-area', { area: null }),
  row('noe-3000', { bundesland: 'noe', bezirk: null, schaetzwertEur: 150_000 }),
  row('land-1500', {
    propertyType: 'land',
    area: area(600, 'grundflaeche'),
    schaetzwertEur: 900_000,
  }),
  row('sold-3000', { status: 'sold', schaetzwertEur: 150_000 }),
  row('house-3500', {
    propertyType: 'house',
    area: area(100, 'wohnflaeche'),
    schaetzwertEur: 350_000,
  }),
]

function ids(query: ListingQueryInput, input = rows): string[] {
  return applyListingQuery(input, ListingQuerySchema.parse(query)).rows.map((listing) => listing.id)
}

describe('applyListingQuery', () => {
  it('applies the "Wien unter 5.000 €/m²" preset', () => {
    const page = applyListingQuery(rows, ListingQuerySchema.parse(PRESET_WIEN_UNDER_5000))
    expect(page.rows.map((listing) => listing.id)).toEqual(['house-3500', 'apartment-4000'])
    expect(page.rows.map((listing) => listing.pricePerSqm)).toEqual([3500, 4000])
    expect(page.totalInScope).toBe(rows.length)
  })

  it('keeps listings without an area only when asked, sorted last', () => {
    expect(ids({ ...PRESET_WIEN_UNDER_5000, includeWithoutArea: true })).toEqual([
      'house-3500',
      'apartment-4000',
      'apartment-no-area',
    ])
  })

  it('recomputes €/m² for the geringstes Gebot', () => {
    const page = applyListingQuery(
      rows,
      ListingQuerySchema.parse({ ...PRESET_WIEN_UNDER_5000, priceBasis: 'geringstes_gebot' }),
    )
    const listing = page.rows.find((candidate) => candidate.id === 'apartment-6000')
    expect(listing?.priceBasis).toBe('geringstes_gebot')
    expect(listing?.pricePerSqm).toBe(3000)
  })

  it('hides hidden listings and closed auctions by default', () => {
    const input = [row('visible'), row('hidden', { hidden: true }), row('sold', { status: 'sold' })]
    expect(ids({}, input)).toEqual(['visible'])
    expect(ids({ showHidden: true, statuses: [] }, input)).toEqual(['hidden', 'sold', 'visible'])
  })

  it('matches every search term, ignoring case and ß', () => {
    const input = [
      row('match', { street: 'Musterstraße 3', plz: '1100' }),
      row('other', { street: 'Musterstraße 3', plz: '1220' }),
    ]
    expect(ids({ text: 'MUSTERSTRASSE 1100' }, input)).toEqual(['match'])
  })

  it('drops listings without an auction date from a date range', () => {
    const input = [
      row('early', { auctionAt: '2026-11-30T10:00' }),
      row('inside', { auctionAt: '2026-12-01T09:00' }),
      row('undated', { auctionAt: null }),
    ]
    expect(ids({ auctionFrom: '2026-12-01' }, input)).toEqual(['inside'])
  })

  it('puts empty values last in both sort directions', () => {
    const input = [row('small', { area: area(40) }), row('none', { area: null }), row('large')]
    expect(ids({ sort: { column: 'area', direction: 'desc' } }, input)).toEqual([
      'large',
      'small',
      'none',
    ])
    expect(ids({ sort: { column: 'area', direction: 'asc' } }, input)).toEqual([
      'small',
      'large',
      'none',
    ])
  })

  it('shows sales in insolvency proceedings by default and filters by source', () => {
    const input = [row('auction'), sale('sale')]
    expect(ids({}, input)).toEqual(['auction', 'sale'])
    expect(ids({ sources: ['insolvency_sale'] }, input)).toEqual(['sale'])
    expect(ids({ sources: ['court_auction'] }, input)).toEqual(['auction'])
  })

  it('orders listings without an auction date by publication, newest first', () => {
    const input = [
      sale('a-older', { publishedAt: '2026-10-01' }),
      sale('b-newer', { publishedAt: '2026-11-01' }),
      sale('c-undated', { publishedAt: null }),
      row('auction'),
    ]
    expect(ids({}, input)).toEqual(['auction', 'b-newer', 'a-older', 'c-undated'])
  })

  // A sale states no minimum bid. Read by that basis it would have no price,
  // drop out of every price filter and lose its €/m².
  it('prices a sale in insolvency proceedings by its Schätzwert under either basis', () => {
    const input = [sale('sale', { schaetzwertEur: 200_000 })]
    for (const priceBasis of ['schaetzwert', 'geringstes_gebot'] as const) {
      const page = applyListingQuery(
        input,
        ListingQuerySchema.parse({ priceBasis, maxPrice: 250_000, maxPricePerSqm: 5000 }),
      )
      expect(page.rows.map((listing) => [listing.priceBasis, listing.pricePerSqm])).toEqual([
        ['schaetzwert', 4000],
      ])
    }
  })
})
