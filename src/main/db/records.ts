import { z } from 'zod'
import {
  AnalysisResultSchema,
  CrossCheckSchema,
  EvidenceItemSchema,
  type AnalysisRecord,
  type AnalysisResult,
  type EvidenceItem,
} from '@shared/analysis-schema'
import { approximateReasons, chooseArea, usableAreaKinds } from '@shared/area'
import {
  InsolvencyFactsSchema,
  KurzgutachtenFactsSchema,
  type AreaEstimate,
  type AreaValue,
  type DocumentInfo,
  type InsolvencyFacts,
  type KurzgutachtenFacts,
  type ListingLocation,
  type ListingRow,
} from '@shared/domain'
import type { AnalysisStatus, PriceBasis, RiskLevel } from '@shared/enums'
import { AppErrorCodeSchema, type AppErrorShape } from '@shared/errors'
import { withPriceBasis } from '@shared/listing-query'
import { approximationFromTitle } from '../scraper/object-title'
import type { analyses, areaEstimates, documents, edicts } from './schema'

// Pure mappers from table rows to the shared types. JSON columns are checked
// again on the way out: a value written by another app version must not break
// a read, so invalid values become null or are left out.

export type EdictRow = typeof edicts.$inferSelect
export type DocumentRow = typeof documents.$inferSelect
export type AreaEstimateRow = typeof areaEstimates.$inferSelect
export type AnalysisRow = typeof analyses.$inferSelect

const IntSchema = z.number().int()

/** `scannedPages`: 1-based pages of the document without a text layer. */
export function toDocumentInfo(
  row: DocumentRow,
  scannedPages: readonly number[] = [],
): DocumentInfo {
  return {
    id: row.id,
    edictId: row.edictId,
    kind: row.kind,
    title: row.title,
    fileName: row.fileName,
    url: row.url,
    statedSizeKb: row.statedSizeKb,
    downloaded: row.localPath !== null,
    downloadedAt: row.downloadedAt,
    pageCount: row.pageCount,
    scannedPages: [...scannedPages].sort((a, b) => a - b),
    extractError: row.extractError,
    removedAt: row.removedAt,
  }
}

export function toAreaEstimate(row: AreaEstimateRow): AreaEstimate {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind,
    sqm: row.sqm,
    page: row.page,
    quote: row.quote,
    confidence: row.confidence,
  }
}

export function isAnalysisStale(
  row: Pick<AnalysisRow, 'status' | 'documentIds' | 'documentSha256'>,
  report: Pick<DocumentRow, 'id' | 'sha256'> | null,
): boolean {
  if (row.status !== 'done') return false
  return (
    report === null ||
    firstDocumentId(row.documentIds) !== report.id ||
    row.documentSha256 === null ||
    row.documentSha256 !== report.sha256
  )
}

/** Never throws. A stored result that fails the analysis schema becomes null. */
export function toAnalysisRecord(
  row: AnalysisRow,
  report: Pick<DocumentRow, 'id' | 'sha256'> | null = null,
): AnalysisRecord {
  return {
    id: row.id,
    edictId: row.edictId,
    documentId: firstDocumentId(row.documentIds),
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    status: row.status,
    stale: isAnalysisStale(row, report),
    result: parseAnalysisResult(row.result),
    evidence: parseItems(EvidenceItemSchema, row.evidence),
    crossChecks: parseItems(CrossCheckSchema, row.crossChecks),
    droppedPages: parseItems(IntSchema, row.droppedPages),
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    error: toErrorShape(row.errorCode, row.errorMessage),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  }
}

export function parseAnalysisResult(value: unknown): AnalysisResult | null {
  const parsed = AnalysisResultSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function toKurzgutachtenFacts(value: unknown): KurzgutachtenFacts | null {
  const parsed = KurzgutachtenFactsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function toInsolvencyFacts(value: unknown): InsolvencyFacts | null {
  const parsed = InsolvencyFactsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function parseItems<T>(schema: z.ZodType<T>, value: unknown): T[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : []
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

function firstDocumentId(value: unknown): number | null {
  const parsed = IntSchema.safeParse(Array.isArray(value) ? value[0] : null)
  return parsed.success ? parsed.data : null
}

function toErrorShape(code: string | null, message: string | null): AppErrorShape | null {
  if (code === null) return null
  const parsed = AppErrorCodeSchema.safeParse(code)
  return { code: parsed.success ? parsed.data : 'internal', message: message ?? '' }
}

// ── Listing rows ───────────────────────────────────────────────────────────

/** The edict columns a listing row needs; the list query loads only these. */
export type ListingEdict = Pick<
  EdictRow,
  | 'id'
  | 'source'
  | 'caseKey'
  | 'url'
  | 'status'
  | 'noticeType'
  | 'title'
  | 'categoryLabel'
  | 'categoryCodes'
  | 'propertyType'
  | 'street'
  | 'plz'
  | 'city'
  | 'bundesland'
  | 'bezirk'
  | 'court'
  | 'caseNumber'
  | 'auctionAt'
  | 'publishedAt'
  | 'schaetzwertEur'
  | 'geringstesGebotEur'
  | 'objektgroesseSqm'
  | 'grundstuecksgroesseSqm'
  | 'removedAt'
>

/** What the latest analysis with status done contributes to its listing. */
export interface FinishedAnalysis {
  result: AnalysisResult | null
  evidence: readonly EvidenceItem[]
  /** The document the result's page numbers refer to. */
  documentId: number | null
}

export interface ListingSources {
  starred: boolean
  hidden: boolean
  hasLanggutachten: boolean
  /** Status of the latest analysis, finished or not. */
  analysisStatus: AnalysisStatus | null
  /** Completed history exists, but none matches the current report. */
  analysisStale: boolean
  finished: FinishedAnalysis | null
  estimates: ReadonlyArray<Pick<AreaEstimateRow, 'documentId' | 'kind' | 'sqm' | 'page' | 'quote'>>
  location: ListingLocation | null
}

export function toFinishedAnalysis(
  row: Pick<AnalysisRow, 'result' | 'evidence' | 'documentIds'>,
): FinishedAnalysis {
  return {
    result: parseAnalysisResult(row.result),
    evidence: parseItems(EvidenceItemSchema, row.evidence),
    documentId: firstDocumentId(row.documentIds),
  }
}

/**
 * Builds a listing row the way the renderer's mock does: area from the
 * edict's Objektgröße, then the latest finished analysis, then local
 * estimates; status from the latest analysis and risk from the latest
 * finished one. Also returns every area candidate, for the detail view.
 */
export function buildListingRow(
  edict: ListingEdict,
  sources: ListingSources,
  basis: PriceBasis,
): { row: ListingRow; areaCandidates: AreaValue[] } {
  const listing = listingArea(edict)
  const ai = sources.finished === null ? null : analysisArea(sources.finished)
  const areaCandidates: AreaValue[] = [
    ...(listing === null ? [] : [listing]),
    ...(ai === null ? [] : [ai]),
    ...sources.estimates.map((estimate): AreaValue => ({
      sqm: estimate.sqm,
      kind: estimate.kind,
      source: 'local_estimate',
      page: estimate.page,
      quote: estimate.quote,
      documentId: estimate.documentId,
    })),
  ]
  const choice = chooseArea(areaCandidates, edict.propertyType)
  const result = sources.finished?.result ?? null
  // The analysis read the report, so the facts it states win over the title.
  const ownership = result?.ownership ?? null
  const fromTitle = approximationFromTitle(edict.title, edict.categoryCodes)
  const row: ListingRow = {
    id: edict.id,
    source: edict.source,
    caseKey: edict.caseKey,
    url: edict.url,
    status: edict.status,
    noticeType: edict.noticeType,
    title: edict.title,
    categoryLabel: edict.categoryLabel,
    propertyType: edict.propertyType,
    street: edict.street,
    plz: edict.plz,
    city: edict.city,
    bundesland: edict.bundesland,
    bezirk: edict.bezirk,
    location: sources.location,
    court: edict.court,
    caseNumber: edict.caseNumber,
    auctionAt: edict.auctionAt,
    publishedAt: edict.publishedAt,
    schaetzwertEur: edict.schaetzwertEur,
    geringstesGebotEur: edict.geringstesGebotEur,
    area: choice.area,
    plotSqm: positiveOrNull(edict.grundstuecksgroesseSqm),
    priceBasis: basis,
    pricePerSqm: null,
    approximate: approximateReasons({
      partialOwnership: analysedPartialOwnership(ownership) ?? fromTitle.partialOwnership,
      // The title shows only that there are several units; two is the fewest that means.
      unitCount: ownership?.unit_count ?? (fromTitle.multipleUnits ? 2 : null),
      bundledParking: ownership?.bundled_parking ?? fromTitle.bundledParking,
      areaMismatch: choice.mismatch,
    }),
    analysisStatus: sources.analysisStatus,
    analysisStale: sources.analysisStale,
    hasAnalysis: sources.finished !== null,
    riskLevel: highestRisk(result),
    hasLanggutachten: sources.hasLanggutachten,
    starred: sources.starred,
    hidden: sources.hidden,
    removedAt: edict.removedAt,
  }
  return { row: withPriceBasis(row, basis), areaCandidates }
}

/**
 * The area the edict page states. Objektgröße counts as the first usable kind
 * of the object type; plots use the Grundstücksgröße when the page gives one.
 */
function listingArea(
  edict: Pick<EdictRow, 'propertyType' | 'objektgroesseSqm' | 'grundstuecksgroesseSqm'>,
): AreaValue | null {
  const [kind] = usableAreaKinds(edict.propertyType)
  if (kind === undefined) return null
  const sqm = positiveOrNull(
    kind === 'grundflaeche'
      ? (edict.grundstuecksgroesseSqm ?? edict.objektgroesseSqm)
      : edict.objektgroesseSqm,
  )
  if (sqm === null) return null
  return { sqm, kind, source: 'listing', page: null, quote: null, documentId: null }
}

/** The area the analysis chose; verified when the evidence check found its quote. */
function analysisArea(analysis: FinishedAnalysis): AreaValue | null {
  const index = analysis.result?.primary_area_index ?? null
  const area = index === null ? undefined : analysis.result?.areas[index]
  if (area === undefined) return null
  const evidence = analysis.evidence.find((item) => item.path === `areas.${index}`)
  const found = evidence?.status === 'verified' || evidence?.status === 'wrong_page'
  return {
    sqm: area.sqm,
    kind: area.kind,
    source: found ? 'ai_verified' : 'ai_unverified',
    // For wrong_page the evidence holds the page where the quote really is.
    page: found ? (evidence?.page ?? area.page) : area.page,
    quote: area.quote,
    documentId: analysis.documentId,
  }
}

const RISK_ORDER: readonly RiskLevel[] = ['low', 'medium', 'high']

export function highestRisk(result: AnalysisResult | null): RiskLevel | null {
  if (result === null || result.risks.length === 0) return null
  return result.risks.reduce<RiskLevel>(
    (highest, risk) =>
      RISK_ORDER.indexOf(risk.severity) > RISK_ORDER.indexOf(highest) ? risk.severity : highest,
    'low',
  )
}

/**
 * Whether the analysis found a part share; null when it leaves that open.
 * Only a share stated as a fraction below 1, outside Wohnungseigentum, counts:
 * every Wohnungseigentum unit is a share of the building and is sold whole.
 */
function analysedPartialOwnership(ownership: AnalysisResult['ownership'] | null): boolean | null {
  if (ownership === null) return null
  if (ownership.wohnungseigentum === true) return false
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(ownership.share ?? '')
  if (match === null || ownership.wohnungseigentum === null) return null
  const part = Number(match[1])
  const whole = Number(match[2])
  return whole > 0 && part < whole
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null
}
