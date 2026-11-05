import type { AnalysisResult, CrossCheck } from '@shared/analysis-schema'
import { AREA_MISMATCH_THRESHOLD, usableAreaKinds } from '@shared/area'
import type { PropertyType } from '@shared/enums'
import type { EdictFacts } from './types'

/** Relative gap between Verkehrswert and Schätzwert that raises a warning. Smaller gaps are info. */
export const VALUE_MISMATCH_THRESHOLD = 0.1
/** How close usable area plus cellar must come to the Objektgröße, relative to it. */
export const CELLAR_MATCH_TOLERANCE = 0.02

export type AnalysisArea = AnalysisResult['areas'][number]

export type CrossCheckFacts = Pick<
  EdictFacts,
  'propertyType' | 'schaetzwertEur' | 'objektgroesseSqm'
>

/**
 * Compares the analysis with the edict. The edict values stay authoritative;
 * each check records both values and the gap in percent of the edict value.
 * - area_vs_objektgroesse: the usable area against the Objektgröße; a warning
 *   above AREA_MISMATCH_THRESHOLD.
 * - verkehrswert_vs_schaetzwert: always recorded when both exist; a warning
 *   above VALUE_MISMATCH_THRESHOLD.
 * - cellar_in_objektgroesse: the Objektgröße matches usable area plus cellar.
 *   analysisValue is the cellar area; deltaPercent is the usable area's gap to
 *   the Objektgröße. Checked for every object type except plots.
 */
export function runCrossChecks(result: AnalysisResult, edict: CrossCheckFacts): CrossCheck[] {
  const checks: CrossCheck[] = []
  const usable = primaryArea(result, edict.propertyType)
  const objekt =
    edict.objektgroesseSqm !== null && edict.objektgroesseSqm > 0 ? edict.objektgroesseSqm : null

  if (objekt !== null && usable !== null) {
    const delta = (usable.sqm - objekt) / objekt
    checks.push({
      kind: 'area_vs_objektgroesse',
      severity: Math.abs(delta) > AREA_MISMATCH_THRESHOLD ? 'warning' : 'info',
      listingValue: objekt,
      analysisValue: usable.sqm,
      deltaPercent: percent(delta),
    })
  }

  const schaetzwert = edict.schaetzwertEur
  const verkehrswert = result.verkehrswert?.eur ?? null
  if (schaetzwert !== null && schaetzwert > 0 && verkehrswert !== null) {
    const delta = (verkehrswert - schaetzwert) / schaetzwert
    checks.push({
      kind: 'verkehrswert_vs_schaetzwert',
      severity: Math.abs(delta) > VALUE_MISMATCH_THRESHOLD ? 'warning' : 'info',
      listingValue: schaetzwert,
      analysisValue: verkehrswert,
      deltaPercent: percent(delta),
    })
  }

  if (objekt !== null && usable !== null && usable.kind !== 'grundflaeche') {
    const cellar = includedCellar(result, usable.sqm, objekt)
    if (cellar !== null) {
      checks.push({
        kind: 'cellar_in_objektgroesse',
        severity: 'warning',
        listingValue: objekt,
        analysisValue: cellar,
        deltaPercent: percent((usable.sqm - objekt) / objekt),
      })
    }
  }
  return checks
}

/**
 * The area a price per m² uses: the model's pick when its kind suits the
 * object type, otherwise the first area of the most suitable kind.
 */
export function primaryArea(
  result: AnalysisResult,
  propertyType: PropertyType,
): AnalysisArea | null {
  const kinds = usableAreaKinds(propertyType)
  const index = result.primary_area_index
  const picked = index === null ? undefined : result.areas[index]
  if (picked !== undefined && kinds.includes(picked.kind)) return picked
  for (const kind of kinds) {
    const area = result.areas.find((candidate) => candidate.kind === kind)
    if (area !== undefined) return area
  }
  return null
}

function includedCellar(result: AnalysisResult, usable: number, objekt: number): number | null {
  const cellars = result.areas.filter((area) => area.kind === 'keller').map((area) => area.sqm)
  const candidates =
    cellars.length > 1 ? [...cellars, cellars.reduce((total, sqm) => total + sqm, 0)] : cellars
  const gapWithout = Math.abs(usable - objekt)
  let best: number | null = null
  let bestGap = Number.POSITIVE_INFINITY
  for (const cellar of candidates) {
    const gap = Math.abs(usable + cellar - objekt)
    if (gap <= CELLAR_MATCH_TOLERANCE * objekt && gap < gapWithout && gap < bestGap) {
      best = cellar
      bestGap = gap
    }
  }
  return best
}

function percent(ratio: number): number {
  return Math.round(ratio * 10_000) / 100
}
