import { describe, expect, it } from 'vitest'
import { approximateReasons, chooseArea, pricePerSqm } from '@shared/area'
import type { AreaValue } from '@shared/domain'

function area(sqm: number, kind: AreaValue['kind'], source: AreaValue['source']): AreaValue {
  return { sqm, kind, source, page: null, quote: null, documentId: null }
}

describe('chooseArea', () => {
  it('prefers the listing, then verified AI values, then the local estimate', () => {
    const candidates = [
      area(70, 'nutzflaeche', 'local_estimate'),
      area(66, 'nutzflaeche', 'ai_verified'),
      area(65.76, 'nutzflaeche', 'listing'),
    ]
    expect(chooseArea(candidates, 'apartment').area?.sqm).toBe(65.76)
    expect(chooseArea(candidates.slice(0, 2), 'apartment').area?.sqm).toBe(66)
  })

  it('orders area kinds by object type and ignores cellars', () => {
    const candidates = [
      area(64.92, 'keller', 'listing'),
      area(120, 'wohnflaeche', 'ai_verified'),
      area(135.93, 'nutzflaeche', 'ai_verified'),
    ]
    expect(chooseArea(candidates, 'house').area?.kind).toBe('wohnflaeche')
    expect(chooseArea(candidates, 'apartment').area?.kind).toBe('nutzflaeche')
    expect(chooseArea(candidates, 'land').area).toBeNull()
  })

  it('flags a gap above 10% only between different sources', () => {
    const sameSource = [area(100, 'wohnflaeche', 'listing'), area(130, 'nutzflaeche', 'listing')]
    expect(chooseArea(sameSource, 'house').mismatch).toBe(false)

    const crossSource = [
      area(100, 'nutzflaeche', 'listing'),
      area(111, 'nutzflaeche', 'ai_verified'),
    ]
    expect(chooseArea(crossSource, 'apartment').mismatch).toBe(true)

    const close = [area(100, 'nutzflaeche', 'listing'), area(109, 'nutzflaeche', 'ai_verified')]
    expect(chooseArea(close, 'apartment').mismatch).toBe(false)
  })
})

describe('pricePerSqm', () => {
  it('returns null when the price or area is missing', () => {
    expect(pricePerSqm(245_000, 65.76)).toBeCloseTo(3725.67, 2)
    expect(pricePerSqm(null, 65.76)).toBeNull()
    expect(pricePerSqm(245_000, null)).toBeNull()
  })
})

describe('approximateReasons', () => {
  it('lists every reason that makes €/m² approximate', () => {
    const none = {
      partialOwnership: false,
      unitCount: 1,
      bundledParking: null,
      areaMismatch: false,
    }
    expect(approximateReasons(none)).toEqual([])
    expect(
      approximateReasons({
        partialOwnership: true,
        unitCount: 3,
        bundledParking: true,
        areaMismatch: true,
      }),
    ).toEqual(['partial_ownership', 'multiple_units', 'bundled_parking', 'area_mismatch'])
  })
})
