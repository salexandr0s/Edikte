import { describe, expect, it } from 'vitest'
import type { AnalysisResult } from '@shared/analysis-schema'
import {
  primaryArea,
  runCrossChecks,
  type AnalysisArea,
} from '../../../src/main/ai/analysis/cross-checks'
import { houseAnswer, houseEdict } from './helpers'

function area(kind: AnalysisArea['kind'], sqm: number): AnalysisArea {
  return { kind, label: kind, sqm, page: null, quote: null }
}

function withAreas(
  areas: AnalysisArea[],
  verkehrswertEur: number | null = null,
  primaryIndex: number | null = null,
): AnalysisResult {
  return {
    ...houseAnswer,
    areas,
    primary_area_index: primaryIndex,
    verkehrswert:
      verkehrswertEur === null
        ? null
        : { eur: verkehrswertEur, stichtag: null, page: null, quote: null },
  }
}

describe('runCrossChecks', () => {
  it('flags an Objektgröße that adds the cellar to the living area of a house', () => {
    expect(runCrossChecks(houseAnswer, houseEdict)).toEqual([
      {
        kind: 'area_vs_objektgroesse',
        severity: 'warning',
        listingValue: 135.93,
        analysisValue: 71.01,
        deltaPercent: -47.76,
      },
      {
        kind: 'verkehrswert_vs_schaetzwert',
        severity: 'info',
        listingValue: 544_000,
        analysisValue: 556_000,
        deltaPercent: 2.21,
      },
      {
        kind: 'cellar_in_objektgroesse',
        severity: 'warning',
        listingValue: 135.93,
        analysisValue: 64.92,
        deltaPercent: -47.76,
      },
    ])
  })

  it('rates gaps against the thresholds', () => {
    const result = withAreas([area('nutzflaeche', 130), area('keller', 64.92)], 700_000)
    expect(runCrossChecks(result, houseEdict)).toEqual([
      {
        kind: 'area_vs_objektgroesse',
        severity: 'info',
        listingValue: 135.93,
        analysisValue: 130,
        deltaPercent: -4.36,
      },
      {
        kind: 'verkehrswert_vs_schaetzwert',
        severity: 'warning',
        listingValue: 544_000,
        analysisValue: 700_000,
        deltaPercent: 28.68,
      },
    ])
  })

  it('adds up a cellar listed in parts', () => {
    const result = withAreas([
      area('wohnflaeche', 71.01),
      area('keller', 30),
      area('keller', 34.92),
    ])
    const cellar = runCrossChecks(result, houseEdict).find(
      (check) => check.kind === 'cellar_in_objektgroesse',
    )
    expect(cellar?.analysisValue).toBeCloseTo(64.92)
  })

  it('needs the edict values and never looks for cellars on plots', () => {
    expect(
      runCrossChecks(houseAnswer, {
        propertyType: 'house',
        schaetzwertEur: null,
        objektgroesseSqm: null,
      }),
    ).toEqual([])
    const plot = withAreas([area('grundflaeche', 612), area('keller', 12)])
    expect(
      runCrossChecks(plot, { propertyType: 'land', schaetzwertEur: null, objektgroesseSqm: 600 }),
    ).toEqual([
      {
        kind: 'area_vs_objektgroesse',
        severity: 'info',
        listingValue: 600,
        analysisValue: 612,
        deltaPercent: 2,
      },
    ])
  })
})

describe('primaryArea', () => {
  it("uses the model's pick only when its kind suits the object type", () => {
    expect(primaryArea(houseAnswer, 'house')?.sqm).toBe(71.01)
    const result = withAreas(
      [area('keller', 64.92), area('wohnflaeche', 80), area('nutzflaeche', 90)],
      null,
      0,
    )
    expect(primaryArea(result, 'house')?.sqm).toBe(80)
    expect(primaryArea(result, 'apartment')?.sqm).toBe(90)
    expect(primaryArea(result, 'land')).toBeNull()
  })
})
