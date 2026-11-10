import { z } from 'zod'
import { AnalysisRecordSchema } from './analysis-schema'
import {
  AnalysisStatusSchema,
  ApproximateReasonSchema,
  AreaKindSchema,
  AreaSourceSchema,
  BundeslandSchema,
  DocumentKindSchema,
  EdictSourceSchema,
  ListingStatusSchema,
  NoticeTypeSchema,
  PriceBasisSchema,
  PropertyTypeSchema,
  RiskLevelSchema,
} from './enums'
import { ProviderIdSchema } from './providers'

// Money is stored and passed in euros as plain numbers. Values are only shown
// and divided by areas, never summed, so floating point is precise enough.
// Dates from the site are Vienna local time: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm".
// Timestamps created by the app are ISO 8601 UTC strings.

export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const LocalDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)

const BezirkSchema = z.number().int().min(1).max(23)

export const AreaValueSchema = z.object({
  sqm: z.number().positive(),
  kind: AreaKindSchema,
  source: AreaSourceSchema,
  /** 1-based PDF page, when the value came from a document. */
  page: z.number().int().positive().nullable(),
  quote: z.string().nullable(),
  documentId: z.number().int().nullable(),
})
export type AreaValue = z.infer<typeof AreaValueSchema>

/** How closely the geocoder could place an address. */
export const LocationPrecisionSchema = z.enum(['address', 'street', 'place'])
export type LocationPrecision = z.infer<typeof LocationPrecisionSchema>

/** Where the listing's address sits on the map, from the geocoder. */
export const ListingLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** `address` is the house, `street` the street, `place` only the town or postcode. */
  precision: LocationPrecisionSchema,
})
export type ListingLocation = z.infer<typeof ListingLocationSchema>

// ── Listings ───────────────────────────────────────────────────────────────

/** One row of the listings table. `id` is the edict ID, in one of the forms of `edict-id.ts`. */
export const ListingRowSchema = z.object({
  id: z.string(),
  /** The section of the Ediktsdatei the edict was published in. */
  source: EdictSourceSchema,
  /** Groups re-issued edicts of the same property. Star, hide and notes attach to it. */
  caseKey: z.string(),
  url: z.string(),
  status: ListingStatusSchema,
  noticeType: NoticeTypeSchema,
  /** Object description as published, e.g. "Eigentumswohnung Top 12". */
  title: z.string(),
  categoryLabel: z.string().nullable(),
  propertyType: PropertyTypeSchema,
  street: z.string().nullable(),
  plz: z.string().nullable(),
  city: z.string().nullable(),
  bundesland: BundeslandSchema.nullable(),
  bezirk: BezirkSchema.nullable(),
  /** Null until the address has been looked up, or when the geocoder did not find it. */
  location: ListingLocationSchema.nullable(),
  court: z.string().nullable(),
  caseNumber: z.string().nullable(),
  /** Auctions only. A sale in insolvency proceedings has no date. */
  auctionAt: LocalDateTimeSchema.nullable(),
  publishedAt: LocalDateSchema.nullable(),
  /** For a sale in insolvency proceedings, the notice's "Wert des Objekts". */
  schaetzwertEur: z.number().nonnegative().nullable(),
  /** Auctions only. */
  geringstesGebotEur: z.number().nonnegative().nullable(),
  area: AreaValueSchema.nullable(),
  plotSqm: z.number().positive().nullable(),
  /** The price `pricePerSqm` rests on. A sale in insolvency proceedings always uses the Schätzwert. */
  priceBasis: PriceBasisSchema,
  pricePerSqm: z.number().nonnegative().nullable(),
  approximate: z.array(ApproximateReasonSchema),
  /** Status of the newest analysis run, finished or not. */
  analysisStatus: AnalysisStatusSchema.nullable(),
  /** A finished analysis of the active report exists, even while a newer run is unfinished. */
  hasAnalysis: z.boolean(),
  /** Finished history exists, but none of it describes the current active report. */
  analysisStale: z.boolean(),
  riskLevel: RiskLevelSchema.nullable(),
  hasLanggutachten: z.boolean(),
  starred: z.boolean(),
  hidden: z.boolean(),
  removedAt: z.string().nullable(),
})
export type ListingRow = z.infer<typeof ListingRowSchema>

export const ListingSortColumnSchema = z.enum([
  'auctionAt',
  'publishedAt',
  'pricePerSqm',
  'price',
  'area',
  'bezirk',
])

export const ListingQuerySchema = z.object({
  /** Empty means every source, as with the other lists of this query. */
  sources: z.array(EdictSourceSchema).default([]),
  bundeslaender: z.array(BundeslandSchema).default([]),
  bezirke: z.array(BezirkSchema).default([]),
  propertyTypes: z.array(PropertyTypeSchema).default([]),
  statuses: z.array(ListingStatusSchema).default(['upcoming', 'postponed', 'on_offer']),
  maxPricePerSqm: z.number().positive().nullable().default(null),
  minArea: z.number().nonnegative().nullable().default(null),
  maxArea: z.number().positive().nullable().default(null),
  minPrice: z.number().nonnegative().nullable().default(null),
  maxPrice: z.number().positive().nullable().default(null),
  auctionFrom: LocalDateSchema.nullable().default(null),
  auctionTo: LocalDateSchema.nullable().default(null),
  riskLevels: z.array(RiskLevelSchema).default([]),
  analyzedOnly: z.boolean().default(false),
  /** Keep listings without any area in €/m² filters. */
  includeWithoutArea: z.boolean().default(false),
  priceBasis: PriceBasisSchema.default('schaetzwert'),
  starredOnly: z.boolean().default(false),
  showHidden: z.boolean().default(false),
  text: z.string().max(200).default(''),
  sort: z
    .object({
      column: ListingSortColumnSchema,
      direction: z.enum(['asc', 'desc']),
    })
    .default({ column: 'auctionAt', direction: 'asc' }),
})
export type ListingQuery = z.infer<typeof ListingQuerySchema>
export type ListingQueryInput = z.input<typeof ListingQuerySchema>

export const ListingPageSchema = z.object({
  rows: z.array(ListingRowSchema),
  /** Listings in the synced scope before filters. */
  totalInScope: z.number().int().nonnegative(),
})
export type ListingPage = z.infer<typeof ListingPageSchema>

/** State of the address lookups that give listings their map positions. */
export const GeocodeProgressSchema = z.object({
  /** Addresses in the synced scope still waiting for a lookup. */
  pending: z.number().int().nonnegative(),
  running: z.boolean(),
})
export type GeocodeProgress = z.infer<typeof GeocodeProgressSchema>

export const DocumentInfoSchema = z.object({
  id: z.number().int(),
  edictId: z.string(),
  kind: DocumentKindSchema,
  /** Link title as published, e.g. "Langgutachten (pdf)". */
  title: z.string(),
  fileName: z.string(),
  url: z.string(),
  statedSizeKb: z.number().int().nonnegative().nullable(),
  downloaded: z.boolean(),
  downloadedAt: z.string().nullable(),
  pageCount: z.number().int().nonnegative().nullable(),
  /** Pages without a text layer, likely scans. */
  scannedPages: z.array(z.number().int().positive()),
  extractError: z.string().nullable(),
  /** When the notice stopped listing the file. Null while it is published. */
  removedAt: z.string().nullable(),
})
export type DocumentInfo = z.infer<typeof DocumentInfoSchema>

/** Facts from the Kurzgutachten HTML page, read during sync without AI. */
export const KurzgutachtenFactsSchema = z.object({
  anschluesse: z.string().nullable(),
  baubewilligung: z.string().nullable(),
  widmung: z.string().nullable(),
  bestandsverhaeltnisse: z.string().nullable(),
  stichtag: z.string().nullable(),
  lasten: z.string().nullable(),
  erstelltVon: z.string().nullable(),
  /** Every other label on the page, as published. */
  other: z.record(z.string(), z.string()),
})
export type KurzgutachtenFacts = z.infer<typeof KurzgutachtenFactsSchema>

/** The administrator of an insolvency or the deputy, as named on the notice. */
export const InsolvencyContactSchema = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  fax: z.string().nullable(),
  email: z.string().nullable(),
})
export type InsolvencyContact = z.infer<typeof InsolvencyContactSchema>

/**
 * What a sale in insolvency proceedings states beyond the property. The
 * notice also names the debtor; the app does not store that.
 */
export const InsolvencyFactsSchema = z.object({
  administrator: InsolvencyContactSchema.nullable(),
  deputy: InsolvencyContactSchema.nullable(),
  /** "Beschreibung", the long text of the notice. */
  description: z.string().nullable(),
  /** "Weiterführender Link" as published. Shown as text and never opened. */
  link: z.string().nullable(),
})
export type InsolvencyFacts = z.infer<typeof InsolvencyFactsSchema>

export const AreaEstimateSchema = z.object({
  id: z.number().int(),
  documentId: z.number().int(),
  kind: AreaKindSchema,
  sqm: z.number().positive(),
  page: z.number().int().positive(),
  quote: z.string(),
  confidence: z.enum(['low', 'medium']),
})
export type AreaEstimate = z.infer<typeof AreaEstimateSchema>

/** Another edict of the same case, e.g. the earlier date of a re-scheduled auction. */
export const RelatedEdictSchema = z.object({
  id: z.string(),
  noticeType: NoticeTypeSchema,
  status: ListingStatusSchema,
  publishedAt: LocalDateSchema.nullable(),
  auctionAt: LocalDateTimeSchema.nullable(),
  url: z.string(),
})
export type RelatedEdict = z.infer<typeof RelatedEdictSchema>

export const ListingDetailSchema = ListingRowSchema.extend({
  vadiumEur: z.number().nonnegative().nullable(),
  /** Winning bid, stated on Zuschlag notices. */
  meistbotEur: z.number().nonnegative().nullable(),
  zubehoer: z.string().nullable(),
  objektgroesseRaw: z.string().nullable(),
  grundbuch: z.string().nullable(),
  ez: z.string().nullable(),
  auctionPlace: z.string().nullable(),
  viewing: z.string().nullable(),
  remarks: z.string().nullable(),
  /** Every label/value pair on the edict page, as published. */
  rawLabels: z.record(z.string(), z.string()),
  kurzgutachten: KurzgutachtenFactsSchema.nullable(),
  /** Set for a sale in insolvency proceedings, null for an auction. */
  insolvency: InsolvencyFactsSchema.nullable(),
  documents: z.array(DocumentInfoSchema),
  estimates: z.array(AreaEstimateSchema),
  /** Every area value known for the listing; `area` is the chosen one. */
  areaCandidates: z.array(AreaValueSchema),
  related: z.array(RelatedEdictSchema),
  /** Latest analysis, finished or in progress. */
  analysis: AnalysisRecordSchema.nullable(),
  notes: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
})
export type ListingDetail = z.infer<typeof ListingDetailSchema>

export const UserStateSchema = z.object({
  caseKey: z.string(),
  starred: z.boolean(),
  hidden: z.boolean(),
  notes: z.string(),
  updatedAt: z.string(),
})
export type UserState = z.infer<typeof UserStateSchema>

export const SavedFilterSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(80),
  query: ListingQuerySchema,
  /** Set for filters shipped with the app; the renderer shows a translated name. */
  presetKey: z.enum(['wien_under_5000']).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type SavedFilter = z.infer<typeof SavedFilterSchema>

// ── Sync ───────────────────────────────────────────────────────────────────

/** One run reads one source over the Bundesländer in scope. */
export const SyncRunSummarySchema = z.object({
  id: z.number().int(),
  source: EdictSourceSchema,
  kind: z.enum(['full', 'incremental']),
  status: z.enum(['running', 'ok', 'degraded', 'failed', 'cancelled']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  listed: z.number().int().nonnegative(),
  fetched: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  /** Why a run was marked degraded or failed. */
  note: z.string().nullable(),
})
export type SyncRunSummary = z.infer<typeof SyncRunSummarySchema>

export const SyncStatusSchema = z.object({
  state: z.enum(['idle', 'running', 'cancelling']),
  phase: z.enum(['list', 'details', 'kurzgutachten']).nullable(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** The run in progress. Its `source` names the section being read. */
  current: SyncRunSummarySchema.nullable(),
  /** The newest finished run of each enabled source that has one, in sync order. */
  lastRuns: z.array(SyncRunSummarySchema),
})
export type SyncStatus = z.infer<typeof SyncStatusSchema>

// ── Documents and analysis jobs ────────────────────────────────────────────

export const FillPlanSchema = z.object({
  /** Listings in the query without any area. */
  listings: z.number().int().nonnegative(),
  /** Documents that would be downloaded. */
  documents: z.number().int().nonnegative(),
  /** Cached documents whose local area estimate needs to be read again. */
  cachedDocuments: z.number().int().nonnegative(),
  totalKb: z.number().int().nonnegative(),
})
export type FillPlan = z.infer<typeof FillPlanSchema>

export const DocumentProgressSchema = z.object({
  job: z.enum(['single', 'fill']),
  phase: z.enum(['download', 'extract', 'estimate', 'done', 'failed', 'cancelled']),
  documentId: z.number().int().nullable(),
  edictId: z.string().nullable(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  bytesDone: z.number().int().nonnegative().nullable(),
  bytesTotal: z.number().int().nonnegative().nullable(),
})
export type DocumentProgress = z.infer<typeof DocumentProgressSchema>

export const AnalysisEstimateSchema = z.object({
  listings: z.number().int().nonnegative(),
  /** Listings that already have a finished analysis with the current prompt. */
  alreadyAnalyzed: z.number().int().nonnegative(),
  /** Listings without a Langgutachten to analyze. */
  withoutDocument: z.number().int().nonnegative(),
  /** Gutachten that must be downloaded first. */
  downloadKb: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Only for API-key providers with known prices. */
  costUsd: z.number().nonnegative().nullable(),
  provider: ProviderIdSchema.nullable(),
  model: z.string().nullable(),
})
export type AnalysisEstimate = z.infer<typeof AnalysisEstimateSchema>

export const AnalysisProgressSchema = z.object({
  analysisId: z.number().int(),
  edictId: z.string(),
  status: AnalysisStatusSchema,
  step: z.enum(['waiting', 'downloading', 'reading', 'rendering', 'asking', 'checking']).nullable(),
  /** Jobs still waiting behind this one. */
  queued: z.number().int().nonnegative(),
})
export type AnalysisProgress = z.infer<typeof AnalysisProgressSchema>

// ── Settings and app info ──────────────────────────────────────────────────

export const LanguageSettingSchema = z.enum(['system', 'de', 'en'])

// Each setting without its default. Zod 4 applies a default even inside an
// optional field, so a patch schema that inherited the defaults would reset
// every field a patch leaves out.
const settingsFields = {
  language: LanguageSettingSchema,
  syncBundeslaender: z.array(BundeslandSchema).min(1),
  /** The sections the sync reads and the list shows. */
  syncSources: z.array(EdictSourceSchema).min(1),
  autoSync: z.boolean(),
  priceBasis: PriceBasisSchema,
  selectedProvider: ProviderIdSchema.nullable(),
  /** Chosen model per provider. */
  models: z.partialRecord(ProviderIdSchema, z.string().min(1)),
  /** User-chosen CLI binaries. Only set through the main-process file dialog. */
  cliPaths: z.partialRecord(z.enum(['claude-cli', 'codex-cli']), z.string().min(1)),
  /** When the user accepted that Gutachten text goes to the selected provider. */
  analysisConsentAt: z.string().nullable(),
  firstRunCompletedAt: z.string().nullable(),
  /** Days to keep downloaded documents after a case closes. */
  documentRetentionDays: z.number().int().min(1).max(3650),
}

export const SettingsSchema = z.object({
  language: settingsFields.language.default('system'),
  syncBundeslaender: settingsFields.syncBundeslaender.default(['wien']),
  // Both by default, also for a data folder from before the second source.
  syncSources: settingsFields.syncSources.default(['court_auction', 'insolvency_sale']),
  autoSync: settingsFields.autoSync.default(true),
  priceBasis: settingsFields.priceBasis.default('schaetzwert'),
  selectedProvider: settingsFields.selectedProvider.default(null),
  models: settingsFields.models.default({}),
  cliPaths: settingsFields.cliPaths.default({}),
  analysisConsentAt: settingsFields.analysisConsentAt.default(null),
  firstRunCompletedAt: settingsFields.firstRunCompletedAt.default(null),
  documentRetentionDays: settingsFields.documentRetentionDays.default(90),
})
export type Settings = z.infer<typeof SettingsSchema>

/** Fields the renderer may change through `settings:update`. */
export const SettingsPatchSchema = z
  .object(settingsFields)
  .pick({
    language: true,
    syncBundeslaender: true,
    syncSources: true,
    autoSync: true,
    priceBasis: true,
    analysisConsentAt: true,
    firstRunCompletedAt: true,
    documentRetentionDays: true,
  })
  .partial()
  .strict()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.enum(['darwin', 'win32', 'linux']),
  arch: z.string(),
  isPackaged: z.boolean(),
  electronVersion: z.string(),
  /** BCP 47 locale of the operating system, e.g. "de-AT". */
  systemLocale: z.string(),
  dataDir: z.string(),
})
export type AppInfo = z.infer<typeof AppInfoSchema>

/** The preset shipped as a saved filter: Vienna homes under €5,000 per m², from every source. */
export const PRESET_WIEN_UNDER_5000: ListingQueryInput = {
  bundeslaender: ['wien'],
  propertyTypes: ['apartment', 'house', 'multi_family_house'],
  maxPricePerSqm: 5000,
  sort: { column: 'pricePerSqm', direction: 'asc' },
}
