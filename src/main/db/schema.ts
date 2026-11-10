import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { CrossCheck, EvidenceItem } from '@shared/analysis-schema'
import type {
  InsolvencyFacts,
  KurzgutachtenFacts,
  ListingQueryInput,
  LocationPrecision,
} from '@shared/domain'
import type {
  AnalysisStatus,
  AreaKind,
  Bundesland,
  DocumentKind,
  EdictSource,
  ListingStatus,
  NoticeType,
  PropertyType,
} from '@shared/enums'
import type { AppErrorCode } from '@shared/errors'
import type { ProviderId } from '@shared/providers'
import type { ChangeLogEntry } from '../scraper/detail'

// Only type imports from @shared: drizzle-kit loads this file without the alias.
// Site dates are Vienna local time ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"),
// app timestamps are ISO 8601 UTC. Money is in euros.

const jsonArray = sql`'[]'`

export const edicts = sqliteTable(
  'edicts',
  {
    /**
     * A court auction has the site's 32-hex document ID, lowercase. A sale in
     * insolvency proceedings has `mv-` and its JustizOnline record number.
     * One per edict, not per property.
     */
    id: text('id').primaryKey(),
    /** Which list the record comes from: court auctions or sales in insolvency proceedings. */
    source: text('source').$type<EdictSource>().notNull().default('court_auction'),
    /** Court, case number and object, normalised; groups re-issued edicts. */
    caseKey: text('case_key').notNull(),
    noticeType: text('notice_type').$type<NoticeType>().notNull(),
    status: text('status').$type<ListingStatus>().notNull(),
    url: text('url').notNull(),
    court: text('court'),
    caseNumber: text('case_number'),
    categoryLabel: text('category_label'),
    categoryCodes: text('category_codes', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(jsonArray),
    propertyType: text('property_type').$type<PropertyType>().notNull(),
    title: text('title').notNull(),
    street: text('street'),
    plz: text('plz'),
    city: text('city'),
    bundesland: text('bundesland').$type<Bundesland>(),
    bezirk: integer('bezirk'),
    schaetzwertEur: real('schaetzwert_eur'),
    geringstesGebotEur: real('geringstes_gebot_eur'),
    vadiumEur: real('vadium_eur'),
    meistbotEur: real('meistbot_eur'),
    objektgroesseSqm: real('objektgroesse_sqm'),
    objektgroesseRaw: text('objektgroesse_raw'),
    grundstuecksgroesseSqm: real('grundstuecksgroesse_sqm'),
    zubehoer: text('zubehoer'),
    auctionAt: text('auction_at'),
    auctionPlace: text('auction_place'),
    viewing: text('viewing'),
    grundbuch: text('grundbuch'),
    ez: text('ez'),
    remarks: text('remarks'),
    publishedAt: text('published_at'),
    changedAt: text('changed_at'),
    /** The page carries the "Berichtigte Fassung" banner. */
    corrected: integer('corrected', { mode: 'boolean' }).notNull().default(false),
    /** Entries of the page's change log, oldest first. */
    changeLog: text('change_log', { mode: 'json' })
      .$type<ChangeLogEntry[]>()
      .notNull()
      .default(jsonArray),
    /** Every label/value pair on the page, as published. */
    rawLabels: text('raw_labels', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    kurzgutachten: text('kurzgutachten', { mode: 'json' }).$type<KurzgutachtenFacts>(),
    kurzgutachtenUrl: text('kurzgutachten_url'),
    /** Facts only an insolvency sale has, such as the administrator. Null for court auctions. */
    insolvency: text('insolvency', { mode: 'json' }).$type<InsolvencyFacts>(),
    /** IDs from the "Alle Edikte zum Fall" chain. */
    relatedIds: text('related_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(jsonArray),
    contentHash: text('content_hash').notNull(),
    parserVersion: integer('parser_version').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    /** Set when the edict no longer appears in a full list sync. */
    removedAt: text('removed_at'),
  },
  (table) => [
    index('edicts_case_key_idx').on(table.caseKey),
    index('edicts_scope_idx').on(table.bundesland, table.status),
    index('edicts_auction_at_idx').on(table.auctionAt),
  ],
)

/**
 * Map position of an edict's address from the geocoder. A row without
 * coordinates records that the address was not found, so it is not sent
 * again until the address changes.
 */
export const edictLocations = sqliteTable(
  'edict_locations',
  {
    edictId: text('edict_id')
      .primaryKey()
      .references(() => edicts.id, { onDelete: 'cascade' }),
    /** The address as sent to the geocoder; edicts with the same query share the result. */
    query: text('query').notNull(),
    lat: real('lat'),
    lng: real('lng'),
    precision: text('precision').$type<LocationPrecision>(),
    provider: text('provider').notNull(),
    geocodedAt: text('geocoded_at').notNull(),
  },
  (table) => [index('edict_locations_query_idx').on(table.query)],
)

export const documents = sqliteTable(
  'documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    edictId: text('edict_id')
      .notNull()
      .references(() => edicts.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<DocumentKind>().notNull(),
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    url: text('url').notNull(),
    statedSizeKb: integer('stated_size_kb'),
    sha256: text('sha256'),
    bytes: integer('bytes'),
    pageCount: integer('page_count'),
    /** Relative to the documents folder. */
    localPath: text('local_path'),
    downloadedAt: text('downloaded_at'),
    extractedAt: text('extracted_at'),
    extractError: text('extract_error'),
    createdAt: text('created_at').notNull(),
    /** Set when the notice no longer lists the file, as an ISO UTC timestamp. */
    removedAt: text('removed_at'),
  },
  (table) => [
    uniqueIndex('documents_edict_url_idx').on(table.edictId, table.url),
    index('documents_sha256_idx').on(table.sha256),
  ],
)

/** Per-page text of downloaded PDFs. Indexed by the document_pages_fts FTS5 table. */
export const documentPages = sqliteTable(
  'document_pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** 1-based PDF page number. */
    pageNumber: integer('page_number').notNull(),
    /** Page label printed on the page, e.g. "Seite 42", when found. */
    printedLabel: text('printed_label'),
    hasText: integer('has_text', { mode: 'boolean' }).notNull(),
    text: text('text').notNull(),
  },
  (table) => [
    uniqueIndex('document_pages_document_page_idx').on(table.documentId, table.pageNumber),
  ],
)

/** Areas found by the local text scan, without AI. */
export const areaEstimates = sqliteTable(
  'area_estimates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    edictId: text('edict_id')
      .notNull()
      .references(() => edicts.id, { onDelete: 'cascade' }),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AreaKind>().notNull(),
    sqm: real('sqm').notNull(),
    page: integer('page').notNull(),
    quote: text('quote').notNull(),
    confidence: text('confidence').$type<'low' | 'medium'>().notNull(),
    method: text('method').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('area_estimates_edict_idx').on(table.edictId)],
)

export const analyses = sqliteTable(
  'analyses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    edictId: text('edict_id')
      .notNull()
      .references(() => edicts.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<ProviderId>().notNull(),
    /** Model the provider reported; equals requestedModel until the run reports one. */
    model: text('model').notNull(),
    /** Model chosen in Settings when the job was queued, such as "default" or "opus". */
    requestedModel: text('requested_model'),
    /** Account the run used, as the provider reported it. */
    accountLabel: text('account_label'),
    promptVersion: integer('prompt_version').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    status: text('status').$type<AnalysisStatus>().notNull(),
    /** AnalysisResult JSON; validated with Zod when read. */
    result: text('result', { mode: 'json' }).$type<unknown>(),
    evidence: text('evidence', { mode: 'json' })
      .$type<EvidenceItem[]>()
      .notNull()
      .default(jsonArray),
    crossChecks: text('cross_checks', { mode: 'json' })
      .$type<CrossCheck[]>()
      .notNull()
      .default(jsonArray),
    documentIds: text('document_ids', { mode: 'json' })
      .$type<number[]>()
      .notNull()
      .default(jsonArray),
    droppedPages: text('dropped_pages', { mode: 'json' })
      .$type<number[]>()
      .notNull()
      .default(jsonArray),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: real('cost_usd'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /** Provider output as received, for debugging; may be truncated. */
    rawResponse: text('raw_response'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    index('analyses_edict_idx').on(table.edictId, table.createdAt),
    index('analyses_status_idx').on(table.status),
  ],
)

/** Star, hide and notes, kept per case so they survive re-issued edicts. */
export const userState = sqliteTable('user_state', {
  caseKey: text('case_key').primaryKey(),
  starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
})

export const savedFilters = sqliteTable('saved_filters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  query: text('query', { mode: 'json' }).$type<ListingQueryInput>().notNull(),
  presetKey: text('preset_key').unique(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const syncRuns = sqliteTable('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Which list the run read. One run reads one source over one scope. */
  source: text('source').$type<EdictSource>().notNull().default('court_auction'),
  kind: text('kind').$type<'full' | 'incremental'>().notNull(),
  status: text('status').$type<'running' | 'ok' | 'degraded' | 'failed' | 'cancelled'>().notNull(),
  scope: text('scope', { mode: 'json' }).$type<Bundesland[]>().notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  listed: integer('listed').notNull().default(0),
  fetched: integer('fetched').notNull().default(0),
  changed: integer('changed').notNull().default(0),
  removed: integer('removed').notNull().default(0),
  requests: integer('requests').notNull().default(0),
  note: text('note'),
  errors: text('errors', { mode: 'json' }).$type<string[]>().notNull().default(jsonArray),
  /** Code of the error that ended a failed run; null for other runs and older rows. */
  failureCode: text('failure_code').$type<AppErrorCode>(),
})

/** A single row (id 1) holding the Settings JSON. Secrets live in the encrypted store instead. */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull(),
})
