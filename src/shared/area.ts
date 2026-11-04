import type { AreaValue } from './domain'
import type { ApproximateReason, AreaKind, AreaSource, PriceBasis, PropertyType } from './enums'

/** Sources from most to least trusted. */
export const AREA_SOURCE_PRECEDENCE: readonly AreaSource[] = [
  'listing',
  'ai_verified',
  'ai_unverified',
  'local_estimate',
]

/** Relative gap between two area sources above which a listing gets flagged. */
export const AREA_MISMATCH_THRESHOLD = 0.1

/**
 * Area kinds a price per m² may use for each object type. Apartments and
 * offices use Nutzfläche without balconies, terraces, gardens or cellars;
 * plots use Grundfläche, shown as "€/m² Grund".
 */
export function usableAreaKinds(propertyType: PropertyType): readonly AreaKind[] {
  switch (propertyType) {
    case 'land':
    case 'agricultural':
      return ['grundflaeche']
    case 'house':
    case 'multi_family_house':
      return ['wohnflaeche', 'nutzflaeche']
    case 'apartment':
    case 'commercial':
    case 'other':
      return ['nutzflaeche', 'wohnflaeche']
  }
}

export interface AreaChoice {
  area: AreaValue | null
  /** Another usable source differs from the chosen one by more than the threshold. */
  mismatch: boolean
}

/**
 * Picks the area a listing's €/m² uses: the edict's Objektgröße first, then an
 * AI value with a verified quote, then one without, then the local estimate.
 * Within a source, kinds follow the order of `usableAreaKinds`.
 */
export function chooseArea(
  candidates: readonly AreaValue[],
  propertyType: PropertyType,
): AreaChoice {
  const kinds = usableAreaKinds(propertyType)
  const usable = candidates
    .filter((candidate) => kinds.includes(candidate.kind) && candidate.sqm > 0)
    .sort(
      (a, b) =>
        AREA_SOURCE_PRECEDENCE.indexOf(a.source) - AREA_SOURCE_PRECEDENCE.indexOf(b.source) ||
        kinds.indexOf(a.kind) - kinds.indexOf(b.kind),
    )
  const area = usable[0] ?? null
  if (area === null) return { area: null, mismatch: false }
  // Only compare across sources: one Gutachten may list Wohn- and Nutzfläche.
  const mismatch = usable.some(
    (other) =>
      other.source !== area.source &&
      Math.abs(other.sqm - area.sqm) / area.sqm > AREA_MISMATCH_THRESHOLD,
  )
  return { area, mismatch }
}

export function priceForBasis(
  basis: PriceBasis,
  prices: { schaetzwertEur: number | null; geringstesGebotEur: number | null },
): number | null {
  return basis === 'schaetzwert' ? prices.schaetzwertEur : prices.geringstesGebotEur
}

export function pricePerSqm(price: number | null, sqm: number | null): number | null {
  if (price === null || sqm === null || sqm <= 0) return null
  return price / sqm
}

export interface ApproximationInput {
  /** A share of the object is sold, e.g. a Hausanteil or half of a flat. */
  partialOwnership: boolean
  unitCount: number | null
  bundledParking: boolean | null
  areaMismatch: boolean
}

/** Reasons the €/m² value should be shown as approximate. */
export function approximateReasons(input: ApproximationInput): ApproximateReason[] {
  const reasons: ApproximateReason[] = []
  if (input.partialOwnership) reasons.push('partial_ownership')
  if (input.unitCount !== null && input.unitCount > 1) reasons.push('multiple_units')
  if (input.bundledParking === true) reasons.push('bundled_parking')
  if (input.areaMismatch) reasons.push('area_mismatch')
  return reasons
}
