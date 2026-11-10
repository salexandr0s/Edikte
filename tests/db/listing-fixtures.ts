import type { AnalysisResult, EvidenceItem } from '@shared/analysis-schema'
import type { AnalysisStatus, AreaKind, RiskLevel } from '@shared/enums'
import type { AppDatabase } from '../../src/main/db/client'
import { analyses, areaEstimates, documents, edicts } from '../../src/main/db/schema'
import type { EdictRecord } from '../../src/main/scraper/edict-record'
import { PARSER_VERSION } from '../../src/main/scraper/parser-version'

// Rows for the listing and sync store tests. Courts, streets and cases are made up.

export const T0 = '2026-11-01T08:00:00.000Z'

export function edictId(n: number): string {
  return n.toString(16).padStart(32, '0')
}

export function edictRecord(n: number, overrides: Partial<EdictRecord> = {}): EdictRecord {
  const id = edictId(n)
  return {
    id,
    source: 'court_auction',
    caseKey: `case-${n}`,
    noticeType: 'versteigerung',
    status: 'upcoming',
    url: `https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/alldoc/${id}!OpenDocument`,
    court: 'BG Musterstadt',
    caseNumber: `1 E ${n}/26a`,
    categoryLabel: 'Eigentumswohnung',
    categoryCodes: [],
    propertyType: 'apartment',
    title: `Wohnung Top ${n}`,
    street: 'Musterstraße 1',
    plz: '1030',
    city: 'Wien',
    bundesland: 'wien',
    bezirk: 3,
    schaetzwertEur: 200_000,
    geringstesGebotEur: 100_000,
    vadiumEur: 20_000,
    meistbotEur: null,
    objektgroesseSqm: null,
    objektgroesseRaw: null,
    grundstuecksgroesseSqm: null,
    zubehoer: null,
    auctionAt: '2026-12-01T10:00',
    auctionPlace: null,
    viewing: null,
    grundbuch: null,
    ez: null,
    remarks: null,
    publishedAt: '2026-10-20',
    changedAt: null,
    corrected: false,
    changeLog: [],
    rawLabels: {},
    kurzgutachten: null,
    kurzgutachtenUrl: null,
    insolvency: null,
    relatedIds: [],
    contentHash: `hash-${n}`,
    parserVersion: PARSER_VERSION,
    firstSeenAt: T0,
    lastSeenAt: T0,
    fetchedAt: T0,
    removedAt: null,
    ...overrides,
  }
}

export function insertEdict(
  db: AppDatabase,
  n: number,
  overrides: Partial<EdictRecord> = {},
): EdictRecord {
  const record = edictRecord(n, overrides)
  db.insert(edicts).values(record).run()
  return record
}

export function insertDocument(
  db: AppDatabase,
  edict: string,
  overrides: Partial<typeof documents.$inferInsert> = {},
): number {
  return db
    .insert(documents)
    .values({
      edictId: edict,
      kind: 'langgutachten',
      title: 'Langgutachten (pdf)',
      fileName: 'gutachten.pdf',
      url: `https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/0/${edict}/$file/gutachten.pdf`,
      createdAt: T0,
      ...overrides,
    })
    .returning({ id: documents.id })
    .get().id
}

export function insertEstimate(
  db: AppDatabase,
  edict: string,
  documentId: number,
  sqm: number,
  kind: AreaKind = 'nutzflaeche',
): void {
  db.insert(areaEstimates)
    .values({
      edictId: edict,
      documentId,
      kind,
      sqm,
      page: 4,
      quote: `Nutzfläche ${sqm} m²`,
      confidence: 'medium',
      method: 'text_scan',
      createdAt: T0,
    })
    .run()
}

export function insertAnalysis(
  db: AppDatabase,
  edict: string,
  values: {
    status: AnalysisStatus
    result?: unknown
    evidence?: EvidenceItem[]
    documentIds?: number[]
  },
): number {
  return db
    .insert(analyses)
    .values({
      edictId: edict,
      provider: 'claude-cli',
      model: 'opus',
      promptVersion: 1,
      schemaVersion: 1,
      status: values.status,
      result: values.result ?? null,
      evidence: values.evidence ?? [],
      documentIds: values.documentIds ?? [],
      createdAt: T0,
    })
    .returning({ id: analyses.id })
    .get().id
}

/** A valid result whose primary area is a Nutzfläche of 60 m² on page 3. */
export function analysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    areas: [
      {
        kind: 'nutzflaeche',
        label: 'Nutzfläche Top 1',
        sqm: 60,
        page: 3,
        quote: 'Nutzfläche rund 60 m²',
      },
    ],
    primary_area_index: 0,
    verkehrswert: null,
    zubehoer_eur: null,
    property: {
      rooms: null,
      floor: null,
      building_year: null,
      condition: null,
      heating: null,
      hwb_kwh_m2a: null,
      energy_class: null,
    },
    ownership: { share: null, wohnungseigentum: true, unit_count: null, bundled_parking: null },
    tenancy: {
      status: 'vacant',
      mrg_scope: 'unknown',
      monthly_rent_eur: null,
      page: null,
      quote: null,
    },
    encumbrances: [],
    arrears: [],
    defects: [],
    interior_inspected: null,
    risks: [],
    summary_de: 'Zusammenfassung',
    summary_en: 'Summary',
    confidence: 'medium',
    unread_pages: [],
    ...overrides,
  }
}

export function risk(severity: RiskLevel): AnalysisResult['risks'][number] {
  return {
    severity,
    title_de: 'Risiko',
    title_en: 'Risk',
    detail_de: 'Details',
    detail_en: 'Details',
    page: null,
    quote: null,
  }
}
