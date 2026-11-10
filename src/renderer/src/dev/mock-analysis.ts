import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisRecord,
  type AnalysisResult,
  type CrossCheck,
  type EvidenceItem,
} from '@shared/analysis-schema'
import { AREA_MISMATCH_THRESHOLD } from '@shared/area'
import type { AreaValue, DocumentInfo, ListingRow } from '@shared/domain'
import type { RiskLevel } from '@shared/enums'
import type { AppErrorShape } from '@shared/errors'
import { withPriceBasis } from '@shared/listing-query'
import type { ProviderId } from '@shared/providers'

// Made-up analysis results for the mock bridge. Names, pages and amounts are
// invented. Keep data inside functions so production builds can drop the file.

export const MOCK_PROMPT_VERSION = 1

/**
 * Analyses that exist when the mock starts: the first three listings are
 * done, and the house has an older failed attempt.
 */
export function fakeAnalysisHistory(rows: readonly ListingRow[]): AnalysisRecord[] {
  const [first, second, house] = rows
  if (first === undefined || second === undefined || house === undefined) return []
  return [
    failedRecord(house, 1, 'claude-cli', 'opus', '2026-11-03T18:40:00.000Z', {
      code: 'provider_rate_limit',
      message: 'Usage limit reached',
    }),
    fakeAnalysisRecord(first, 2, 'claude-cli', 'opus', '2026-11-04T09:12:00.000Z'),
    {
      ...fakeAnalysisRecord(
        second,
        3,
        'anthropic-api',
        'claude-opus-5-5',
        '2026-11-04T09:16:00.000Z',
      ),
      documentId: 2,
      stale: true,
    },
    fakeAnalysisRecord(house, 4, 'claude-cli', 'opus', '2026-11-04T09:20:00.000Z'),
  ]
}

export function queuedRecord(
  edictId: string,
  id: number,
  provider: ProviderId,
  model: string,
  createdAt: string,
): AnalysisRecord {
  return {
    id,
    edictId,
    documentId: null,
    provider,
    model,
    promptVersion: MOCK_PROMPT_VERSION,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    status: 'queued',
    stale: false,
    result: null,
    evidence: [],
    crossChecks: [],
    droppedPages: [],
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    error: null,
    createdAt,
    startedAt: null,
    finishedAt: null,
  }
}

export function fakeAnalysisRecord(
  row: ListingRow,
  id: number,
  provider: ProviderId,
  model: string,
  createdAt: string,
): AnalysisRecord {
  const result = row.propertyType === 'house' ? houseResult(row) : apartmentResult(row)
  return {
    ...queuedRecord(row.id, id, provider, model, createdAt),
    status: 'done',
    result,
    evidence: evidenceFor(result),
    crossChecks: crossChecksFor(row, result),
    inputTokens: 96_400,
    outputTokens: 6_850,
    costUsd: provider === 'anthropic-api' || provider === 'openai-api' ? 0.65 : null,
    startedAt: createdAt,
    finishedAt: createdAt,
  }
}

export function failedRecord(
  row: ListingRow,
  id: number,
  provider: ProviderId,
  model: string,
  createdAt: string,
  error: AppErrorShape,
): AnalysisRecord {
  return {
    ...queuedRecord(row.id, id, provider, model, createdAt),
    status: 'failed',
    error,
    startedAt: createdAt,
    finishedAt: createdAt,
  }
}

/**
 * The row as main would build it from its analyses: status of the latest one,
 * risk level of the latest finished one, and its area unless the edict states one.
 */
export function rowWithAnalyses(
  row: ListingRow,
  analyses: readonly AnalysisRecord[],
  documents: readonly DocumentInfo[],
): ListingRow {
  const own = analyses.filter((record) => record.edictId === row.id)
  const latestDone = own.findLast((record) => record.status === 'done' && !record.stale)
  const gutachten = documents.find(
    (doc) => doc.edictId === row.id && doc.kind === 'langgutachten' && doc.removedAt === null,
  )
  const aiArea = latestDone === undefined ? null : analysisArea(latestDone, gutachten?.id ?? null)
  const baseArea =
    row.area?.source === 'listing' ||
    (row.area?.source === 'local_estimate' && row.area.documentId === gutachten?.id)
      ? row.area
      : null
  return withPriceBasis(
    {
      ...row,
      analysisStatus: own.at(-1)?.status ?? null,
      hasAnalysis: latestDone !== undefined,
      analysisStale: latestDone === undefined && own.some((record) => record.status === 'done'),
      riskLevel: highestRisk(latestDone?.result ?? null),
      area: baseArea?.source === 'listing' ? baseArea : (aiArea ?? baseArea),
    },
    row.priceBasis,
  )
}

/** The area a finished analysis picked, as an area value of the listing. */
export function analysisArea(record: AnalysisRecord, documentId: number | null): AreaValue | null {
  if (record.stale) return null
  const index = record.result?.primary_area_index ?? null
  const area = index === null ? undefined : record.result?.areas[index]
  if (area === undefined) return null
  const evidence = record.evidence.find((item) => item.path === `areas.${index}`)
  const found = evidence?.status === 'verified' || evidence?.status === 'wrong_page'
  return {
    sqm: area.sqm,
    kind: area.kind,
    source: found ? 'ai_verified' : 'ai_unverified',
    // For wrong_page the evidence holds the page where the quote really is.
    page: found ? (evidence?.page ?? area.page) : area.page,
    quote: area.quote,
    documentId,
  }
}

const RISK_ORDER: readonly RiskLevel[] = ['low', 'medium', 'high']

/** The highest risk severity in a result, as shown in the listings table. */
export function highestRisk(result: AnalysisResult | null): RiskLevel | null {
  if (result === null || result.risks.length === 0) return null
  return result.risks.reduce<RiskLevel>(
    (highest, risk) =>
      RISK_ORDER.indexOf(risk.severity) > RISK_ORDER.indexOf(highest) ? risk.severity : highest,
    'low',
  )
}

function apartmentResult(row: ListingRow): AnalysisResult {
  const sqm = row.area?.sqm ?? 60
  const value = (row.schaetzwertEur ?? 250_000) + 12_000
  return {
    areas: [
      {
        kind: 'nutzflaeche',
        label: 'Nutzfläche Top 12',
        sqm,
        page: 8,
        quote: `Nutzfläche gesamt ${sqmText(sqm)} m²`,
      },
      { kind: 'balkon_terrasse', label: 'Loggia', sqm: 4.2, page: 8, quote: 'Loggia 4,20 m²' },
      { kind: 'keller', label: 'Kellerabteil', sqm: 3.1, page: 9, quote: 'Kellerabteil 3,10 m²' },
    ],
    primary_area_index: 0,
    verkehrswert: {
      eur: value,
      stichtag: '2026-06-15',
      page: 31,
      quote: `Verkehrswert zum Stichtag 15.06.2026: EUR ${eurText(value)},00`,
    },
    zubehoer_eur: null,
    property: {
      rooms: 3,
      floor: '2. Stock',
      building_year: 1974,
      condition: 'gepflegt, Bad erneuerungsbedürftig',
      heating: 'Fernwärme',
      hwb_kwh_m2a: 96,
      energy_class: 'C',
    },
    ownership: {
      share: '152/10000',
      wohnungseigentum: true,
      unit_count: 1,
      bundled_parking: false,
    },
    tenancy: {
      status: 'vacant',
      mrg_scope: 'partial',
      monthly_rent_eur: null,
      page: 12,
      quote: 'Die Wohnung ist zum Bewertungsstichtag bestandfrei.',
    },
    encumbrances: [
      {
        text_de: 'Dienstbarkeit des Gehens über den Hof',
        text_en: 'Right of way across the courtyard',
        amount_eur: null,
        page: 6,
        quote: 'Dienstbarkeit des Gehens über den Hof',
      },
    ],
    arrears: [
      {
        text_de: 'Offene Betriebskosten',
        text_en: 'Unpaid service charges',
        amount_eur: 4_380,
        page: 14,
        quote: 'Rückstand an Betriebskosten in Höhe von EUR 4.380,00',
      },
    ],
    defects: [
      {
        text_de: 'Feuchtigkeitsschaden im Bad',
        text_en: 'Damp damage in the bathroom',
        amount_eur: 6_000,
        page: 10,
        quote: 'Feuchtigkeitsschäden im Badezimmer, Sanierungsaufwand rund EUR 6.000,00',
      },
    ],
    interior_inspected: true,
    risks: [
      {
        severity: 'medium',
        title_de: 'Offene Betriebskosten',
        title_en: 'Unpaid service charges',
        detail_de:
          'Das Gutachten nennt einen Rückstand von 4.380 €. Fragen Sie die Hausverwaltung, wer ihn trägt.',
        detail_en:
          'The Gutachten states arrears of €4,380. Ask the property manager who pays them.',
        page: 14,
        quote: 'Rückstand an Betriebskosten in Höhe von EUR 4.380,00',
      },
      {
        severity: 'low',
        title_de: 'Bad muss saniert werden',
        title_en: 'Bathroom needs repair',
        detail_de: 'Feuchtigkeitsschaden im Bad, geschätzt rund 6.000 €.',
        detail_en: 'Damp damage in the bathroom, estimated at about €6,000.',
        page: 10,
        quote: 'Feuchtigkeitsschäden im Badezimmer',
      },
    ],
    summary_de:
      'Drei-Zimmer-Wohnung im 2. Stock, zum Stichtag bestandfrei. Das Bad hat einen Feuchtigkeitsschaden, und es gibt offene Betriebskosten.',
    summary_en:
      'Three-room apartment on the second floor, vacant at the valuation date. The bathroom has damp damage and service charges are unpaid.',
    confidence: 'high',
    unread_pages: [],
  }
}

function houseResult(row: ListingRow): AnalysisResult {
  const value = row.schaetzwertEur ?? 500_000
  return {
    areas: [
      {
        kind: 'wohnflaeche',
        label: 'Wohnfläche Erdgeschoss und Obergeschoss',
        sqm: 71.01,
        page: 11,
        quote: 'Wohnfläche gesamt 71,01 m²',
      },
      { kind: 'keller', label: 'Keller', sqm: 64.92, page: 11, quote: 'Keller 64,92 m²' },
      { kind: 'grundflaeche', label: 'Grundstück', sqm: 420, page: 5, quote: 'Fläche 420 m²' },
    ],
    primary_area_index: 0,
    verkehrswert: {
      eur: value,
      stichtag: '2026-05-20',
      page: 44,
      quote: `Verkehrswert EUR ${eurText(value)},00`,
    },
    zubehoer_eur: 3_500,
    property: {
      rooms: 4,
      floor: null,
      building_year: 1962,
      condition: 'sanierungsbedürftig',
      heating: 'Gas-Zentralheizung',
      hwb_kwh_m2a: 182,
      energy_class: 'E',
    },
    ownership: { share: '1/1', wohnungseigentum: false, unit_count: 1, bundled_parking: false },
    tenancy: {
      status: 'owner_occupied',
      mrg_scope: 'none',
      monthly_rent_eur: null,
      page: 13,
      quote: 'Das Objekt wird von der Eigentümerin selbst bewohnt.',
    },
    encumbrances: [],
    arrears: [],
    defects: [
      {
        text_de: 'Dach undicht',
        text_en: 'Leaking roof',
        amount_eur: 25_000,
        page: 18,
        quote: 'Die Dacheindeckung ist schadhaft und undicht.',
      },
    ],
    interior_inspected: false,
    risks: [
      {
        severity: 'high',
        title_de: 'Innenräume nicht besichtigt',
        title_en: 'Interior not inspected',
        detail_de:
          'Die Sachverständige konnte das Haus nicht betreten. Zustand und Flächen beruhen auf Plänen.',
        detail_en:
          'The appraiser could not enter the house. Condition and areas are based on plans.',
        page: 3,
        quote: 'Eine Innenbesichtigung war nicht möglich.',
      },
      {
        severity: 'medium',
        title_de: 'Dach undicht',
        title_en: 'Leaking roof',
        detail_de: 'Das Gutachten schätzt die Reparatur auf rund 25.000 €.',
        detail_en: 'The Gutachten puts the repair at about €25,000.',
        page: 18,
        quote: 'Die Dacheindeckung ist schadhaft und undicht.',
      },
    ],
    summary_de:
      'Einfamilienhaus von 1962 auf 420 m² Grund, von der Eigentümerin bewohnt. Das Dach ist undicht, und die Innenräume wurden nicht besichtigt.',
    summary_en:
      'Detached house from 1962 on a 420 m² plot, lived in by the owner. The roof leaks and the interior was not inspected.',
    confidence: 'medium',
    unread_pages: [50, 51],
  }
}

function evidenceFor(result: AnalysisResult): EvidenceItem[] {
  const items: EvidenceItem[] = result.areas.map((area, index) => ({
    path: `areas.${index}`,
    page: area.page,
    status: 'verified',
  }))
  if (result.verkehrswert !== null) {
    items.push({ path: 'verkehrswert', page: result.verkehrswert.page, status: 'verified' })
  }
  items.push({ path: 'tenancy', page: result.tenancy.page, status: 'verified' })
  result.risks.forEach((risk, index) => {
    items.push({
      path: `risks.${index}`,
      page: risk.page,
      status: index === 1 ? 'quote_not_found' : 'verified',
    })
  })
  result.defects.forEach((defect, index) => {
    items.push({ path: `defects.${index}`, page: defect.page, status: 'number_mismatch' })
  })
  return items
}

// The same rules as src/main/ai/analysis/cross-checks.ts, without its edge cases.
function crossChecksFor(row: ListingRow, result: AnalysisResult): CrossCheck[] {
  const checks: CrossCheck[] = []
  const usable =
    result.primary_area_index === null ? undefined : result.areas[result.primary_area_index]
  const objekt = row.area?.source === 'listing' ? row.area.sqm : null
  if (objekt !== null && usable !== undefined) {
    const delta = (usable.sqm - objekt) / objekt
    checks.push({
      kind: 'area_vs_objektgroesse',
      severity: Math.abs(delta) > AREA_MISMATCH_THRESHOLD ? 'warning' : 'info',
      listingValue: objekt,
      analysisValue: usable.sqm,
      deltaPercent: percent(delta),
    })
    const cellar = result.areas.find((area) => area.kind === 'keller')
    if (cellar !== undefined && Math.abs(usable.sqm + cellar.sqm - objekt) <= 0.02 * objekt) {
      checks.push({
        kind: 'cellar_in_objektgroesse',
        severity: 'warning',
        listingValue: objekt,
        analysisValue: cellar.sqm,
        deltaPercent: percent(delta),
      })
    }
  }
  if (result.verkehrswert !== null && row.schaetzwertEur !== null && row.schaetzwertEur > 0) {
    const delta = (result.verkehrswert.eur - row.schaetzwertEur) / row.schaetzwertEur
    checks.push({
      kind: 'verkehrswert_vs_schaetzwert',
      severity: Math.abs(delta) > 0.1 ? 'warning' : 'info',
      listingValue: row.schaetzwertEur,
      analysisValue: result.verkehrswert.eur,
      deltaPercent: percent(delta),
    })
  }
  return checks
}

function percent(ratio: number): number {
  return Math.round(ratio * 10_000) / 100
}

export function sqmText(sqm: number): string {
  return sqm.toFixed(2).replace('.', ',')
}

function eurText(eur: number): string {
  return Math.round(eur)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
