import { z } from 'zod'
import { AnalysisStatusSchema, AreaKindSchema, RiskLevelSchema } from './enums'
import { AppErrorShapeSchema } from './errors'
import { ProviderIdSchema } from './providers'

/**
 * What a model returns for one Gutachten. Field names are snake_case because
 * this is the wire format the model writes. The JSON Schema sent to providers
 * is derived from this schema in src/main/ai/analysis/.
 *
 * Bump ANALYSIS_SCHEMA_VERSION on any change that old stored results would fail.
 */
export const ANALYSIS_SCHEMA_VERSION = 1

const page = z
  .number()
  .int()
  .min(1)
  .nullable()
  .describe('1-based PDF page number that the quote is copied from, or null if there is no quote')

const quote = z
  .string()
  .nullable()
  .describe(
    'Short verbatim excerpt from that page, copied exactly, that states the value (at most about 200 characters)',
  )

export const AnalysisAreaSchema = z.object({
  kind: AreaKindSchema,
  label: z.string().describe('The term as written in the Gutachten, e.g. "Nutzfläche Top 12"'),
  sqm: z.number().positive(),
  page,
  quote,
})

/** A fact stated in both languages, so switching the UI language needs no new run. */
export const AnalysisFindingSchema = z.object({
  text_de: z.string(),
  text_en: z.string(),
  amount_eur: z.number().nonnegative().nullable(),
  page,
  quote,
})

export const AnalysisRiskSchema = z.object({
  severity: RiskLevelSchema,
  title_de: z.string(),
  title_en: z.string(),
  detail_de: z.string(),
  detail_en: z.string(),
  page,
  quote,
})

export const AnalysisResultSchema = z.object({
  areas: z.array(AnalysisAreaSchema),
  primary_area_index: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe('Index into areas of the area a price per m² should use, or null if none fits'),
  verkehrswert: z
    .object({
      eur: z.number().nonnegative(),
      stichtag: z.string().nullable().describe('Valuation date as YYYY-MM-DD'),
      page,
      quote,
    })
    .nullable(),
  zubehoer_eur: z.number().nonnegative().nullable(),
  property: z.object({
    rooms: z.number().positive().nullable(),
    floor: z.string().nullable(),
    building_year: z.number().int().nullable(),
    condition: z.string().nullable(),
    heating: z.string().nullable(),
    hwb_kwh_m2a: z.number().nonnegative().nullable(),
    energy_class: z.string().nullable(),
  }),
  ownership: z.object({
    share: z.string().nullable().describe('Ownership share as written, e.g. "152/10000"'),
    wohnungseigentum: z.boolean().nullable(),
    unit_count: z.number().int().positive().nullable(),
    bundled_parking: z.boolean().nullable(),
  }),
  tenancy: z.object({
    status: z.enum(['vacant', 'owner_occupied', 'rented', 'unknown']),
    mrg_scope: z.enum(['full', 'partial', 'none', 'unknown']),
    monthly_rent_eur: z.number().nonnegative().nullable(),
    page,
    quote,
  }),
  encumbrances: z
    .array(AnalysisFindingSchema)
    .describe('Encumbrances that the buyer takes over (not deleted by the auction)'),
  arrears: z
    .array(AnalysisFindingSchema)
    .describe('Arrears such as unpaid Betriebskosten or Rücklage'),
  defects: z.array(AnalysisFindingSchema),
  interior_inspected: z.boolean().nullable(),
  risks: z.array(AnalysisRiskSchema),
  summary_de: z.string(),
  summary_en: z.string(),
  confidence: RiskLevelSchema.describe('How complete and legible the Gutachten was'),
  unread_pages: z
    .array(z.number().int().min(1))
    .describe('PDF pages that could not be read, e.g. scans without an image'),
})
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>

// ── Checks the app runs on the result ──────────────────────────────────────

export const EvidenceStatusSchema = z.enum([
  'verified',
  /** The quote is on another page than the one cited; `page` is where it was found. */
  'wrong_page',
  'quote_not_found',
  'number_mismatch',
  'scanned_page',
  'page_out_of_range',
  'no_quote',
])
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>

export const EvidenceItemSchema = z.object({
  /** Path into the result, e.g. "areas.0" or "risks.2". */
  path: z.string(),
  /** Cited PDF page, or for `wrong_page` the page where the quote was found. */
  page: z.number().int().nullable(),
  status: EvidenceStatusSchema,
})
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>

export const CrossCheckSchema = z.object({
  kind: z.enum(['area_vs_objektgroesse', 'verkehrswert_vs_schaetzwert', 'cellar_in_objektgroesse']),
  severity: z.enum(['info', 'warning']),
  /** Value from the edict page. */
  listingValue: z.number().nullable(),
  /** Value from the analysis. */
  analysisValue: z.number().nullable(),
  deltaPercent: z.number().nullable(),
})
export type CrossCheck = z.infer<typeof CrossCheckSchema>

export const AnalysisRecordSchema = z.object({
  id: z.number().int(),
  edictId: z.string(),
  /** The Langgutachten the analysis read; result page numbers refer to it. */
  documentId: z.number().int().nullable(),
  provider: ProviderIdSchema,
  model: z.string(),
  promptVersion: z.number().int(),
  schemaVersion: z.number().int(),
  status: AnalysisStatusSchema,
  /** A finished result refers to a report that is no longer the current active report. */
  stale: z.boolean(),
  result: AnalysisResultSchema.nullable(),
  evidence: z.array(EvidenceItemSchema),
  crossChecks: z.array(CrossCheckSchema),
  /** PDF pages left out because the text was over the size cap. */
  droppedPages: z.array(z.number().int()),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  error: AppErrorShapeSchema.nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
})
export type AnalysisRecord = z.infer<typeof AnalysisRecordSchema>
