import { describe, expect, it } from 'vitest'
import type { ListingRow } from '@shared/domain'
import {
  clusterPins,
  groupPins,
  pinPrice,
  type Place,
} from '../../../src/renderer/src/features/listings/map-pins'

function row(id: string, fields: Partial<ListingRow> = {}): ListingRow {
  return {
    id,
    source: 'court_auction',
    caseKey: `case-${id}`,
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
    area: null,
    plotSqm: null,
    priceBasis: 'schaetzwert',
    pricePerSqm: null,
    approximate: [],
    analysisStatus: null,
    hasAnalysis: false,
    analysisStale: false,
    riskLevel: null,
    hasLanggutachten: false,
    starred: false,
    hidden: false,
    removedAt: null,
    ...fields,
  }
}

function at(id: string, lat: number, lng: number, fields: Partial<ListingRow> = {}): ListingRow {
  return row(id, { location: { lat, lng, precision: 'address' }, ...fields })
}

describe('pinPrice', () => {
  const writtenBid = row('written', { schaetzwertEur: null, geringstesGebotEur: 523_500 })
  const unpriced = row('unpriced', { schaetzwertEur: null, geringstesGebotEur: null })

  it('uses a published written bid when the appraisal is missing, including in comparable groups', () => {
    expect(pinPrice([writtenBid])).toEqual({ basis: 'geringstes_gebot', amount: 523_500 })
    const lowerBid = row('lower', { priceBasis: 'geringstes_gebot', geringstesGebotEur: 340_000 })
    expect(pinPrice([writtenBid, lowerBid])).toEqual({ basis: 'geringstes_gebot', amount: 340_000 })
    expect(writtenBid.priceBasis).toBe('schaetzwert')
  })

  it('uses the appraisal when a minimum bid is missing and preserves the selected basis when present', () => {
    expect(
      pinPrice([row('appraised', { priceBasis: 'geringstes_gebot', geringstesGebotEur: null })]),
    ).toEqual({
      basis: 'schaetzwert',
      amount: 200_000,
    })
    expect(pinPrice([row('both')])).toEqual({ basis: 'schaetzwert', amount: 200_000 })
  })

  it('uses a count-only group for missing or incomparable prices', () => {
    expect(pinPrice([unpriced, unpriced])).toBeNull()
    expect(pinPrice([writtenBid, unpriced])).toBeNull()
    expect(pinPrice([row('appraised'), writtenBid])).toBeNull()
  })
})

describe('groupPins', () => {
  it('shares a place between auctions at one point, cheapest first, and skips rows without one', () => {
    const places = groupPins([
      at('dear', 48.2, 16.37, { schaetzwertEur: 300_000 }),
      at('cheap', 48.2, 16.37, { schaetzwertEur: 150_000 }),
      row('nowhere'),
    ])
    expect(places).toHaveLength(1)
    expect(places[0]?.rows.map((r) => r.id)).toEqual(['cheap', 'dear'])
  })

  it('calls a place approximate only when every auction there has just the town', () => {
    const town = { lat: 48.2, lng: 16.37, precision: 'place' as const }
    expect(groupPins([at('a', 48.2, 16.37, { location: town })])[0]?.approximate).toBe(true)
    expect(
      groupPins([at('a', 48.2, 16.37, { location: town }), at('b', 48.2, 16.37)])[0]?.approximate,
    ).toBe(false)
  })
})

describe('clusterPins', () => {
  /** A flat projection, north up: one degree is `scale` pixels. */
  const projectAt = (scale: number) => (place: Place) => ({
    x: place.lng * scale,
    y: -place.lat * scale,
  })
  const places = groupPins([
    at('a', 48.2, 16.3, { schaetzwertEur: 300_000 }),
    at('b', 48.2, 16.31, { schaetzwertEur: 100_000 }),
    at('c', 48.2, 16.32, { schaetzwertEur: 200_000 }),
    at('d', 48.1, 16.3),
  ])

  it('keeps places apart whose labels do not overlap', () => {
    const pins = clusterPins(places, projectAt(100_000))
    expect(pins.map((pin) => pin.key)).toEqual(places.map((place) => place.key))
    expect(pins.every((pin) => pin.places.length === 1)).toBe(true)
  })

  it('joins a place with the ones its label would overlap, not with their neighbours in turn', () => {
    // 100 px between neighbours: a takes b, c is 200 px from a and stays on its own.
    const pins = clusterPins(places, projectAt(10_000))
    expect(pins.map((pin) => pin.places.length)).toEqual([2, 1, 1])
    const [cluster] = pins
    expect(cluster?.key).toBe(`${places[0]?.key}+${places[1]?.key}`)
    expect(cluster?.rows.map((r) => r.id)).toEqual(['b', 'a'])
    expect(cluster?.lat).toBeCloseTo(48.2)
    expect(cluster?.lng).toBeCloseTo(16.305)
  })
})
