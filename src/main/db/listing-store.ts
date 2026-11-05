import { and, asc, desc, eq, inArray, isNull, max, ne, or } from 'drizzle-orm'
import type {
  ListingDetail,
  ListingPage,
  ListingQuery,
  ListingRow,
  RelatedEdict,
} from '@shared/domain'
import type { Bundesland, PriceBasis } from '@shared/enums'
import { AppError } from '@shared/errors'
import { applyListingQuery } from '@shared/listing-query'
import type { AppDatabase } from './client'
import {
  buildListingRow,
  toAnalysisRecord,
  toAreaEstimate,
  toDocumentInfo,
  toFinishedAnalysis,
  toKurzgutachtenFacts,
  type AnalysisRow,
  type AreaEstimateRow,
  type EdictRow,
  type ListingEdict,
} from './records'
import { analyses, areaEstimates, documentPages, documents, edicts, userState } from './schema'
import { readSettings } from './settings-store'

// The listing read model. A query loads each source table once and joins in
// memory: a few thousand edicts take a handful of queries, never one per row.

const listingColumns = {
  id: edicts.id,
  caseKey: edicts.caseKey,
  url: edicts.url,
  status: edicts.status,
  noticeType: edicts.noticeType,
  title: edicts.title,
  categoryLabel: edicts.categoryLabel,
  propertyType: edicts.propertyType,
  street: edicts.street,
  plz: edicts.plz,
  city: edicts.city,
  bundesland: edicts.bundesland,
  bezirk: edicts.bezirk,
  court: edicts.court,
  caseNumber: edicts.caseNumber,
  auctionAt: edicts.auctionAt,
  publishedAt: edicts.publishedAt,
  schaetzwertEur: edicts.schaetzwertEur,
  geringstesGebotEur: edicts.geringstesGebotEur,
  objektgroesseSqm: edicts.objektgroesseSqm,
  grundstuecksgroesseSqm: edicts.grundstuecksgroesseSqm,
  removedAt: edicts.removedAt,
} satisfies Record<keyof ListingEdict, unknown>

/**
 * The `listings:query` response. Rows cover the Bundesländer in the sync
 * settings; edicts the site no longer lists stay out.
 */
export function queryListings(db: AppDatabase, query: ListingQuery): ListingPage {
  const { syncBundeslaender } = readSettings(db)
  return applyListingQuery(loadListingRows(db, syncBundeslaender, query.priceBasis), query)
}

/** The `listings:get` response. Opens removed edicts too. */
export function getListing(db: AppDatabase, id: string): ListingDetail {
  const edict = db.select().from(edicts).where(eq(edicts.id, id)).get()
  if (edict === undefined) throw new AppError('not_found', `Edict ${id} is not stored`)
  const documentRows = db
    .select()
    .from(documents)
    .where(eq(documents.edictId, id))
    .orderBy(asc(documents.id))
    .all()
  const scanned = loadScannedPages(
    db,
    documentRows.map((row) => row.id),
  )
  const estimateRows = db
    .select()
    .from(areaEstimates)
    .where(eq(areaEstimates.edictId, id))
    .orderBy(asc(areaEstimates.id))
    .all()
  const latest = latestAnalysis(db, id)
  const latestDone = latest?.status === 'done' ? latest : latestAnalysis(db, id, 'done')
  const user = db.select().from(userState).where(eq(userState.caseKey, edict.caseKey)).get()
  const { row, areaCandidates } = buildListingRow(
    edict,
    {
      starred: user?.starred ?? false,
      hidden: user?.hidden ?? false,
      hasLanggutachten: documentRows.some((document) => document.kind === 'langgutachten'),
      analysisStatus: latest?.status ?? null,
      finished: latestDone === undefined ? null : toFinishedAnalysis(latestDone),
      estimates: estimateRows,
    },
    readSettings(db).priceBasis,
  )
  return {
    ...row,
    vadiumEur: edict.vadiumEur,
    meistbotEur: edict.meistbotEur,
    zubehoer: edict.zubehoer,
    objektgroesseRaw: edict.objektgroesseRaw,
    grundbuch: edict.grundbuch,
    ez: edict.ez,
    auctionPlace: edict.auctionPlace,
    viewing: edict.viewing,
    remarks: edict.remarks,
    rawLabels: edict.rawLabels,
    kurzgutachten: toKurzgutachtenFacts(edict.kurzgutachten),
    documents: documentRows.map((document) =>
      toDocumentInfo(document, scanned.get(document.id) ?? []),
    ),
    estimates: estimateRows.map(toAreaEstimate),
    areaCandidates,
    related: loadRelated(db, edict),
    analysis: latest === undefined ? null : toAnalysisRecord(latest),
    notes: user?.notes ?? '',
    firstSeenAt: edict.firstSeenAt,
    lastSeenAt: edict.lastSeenAt,
  }
}

/** Pages without a text layer, by document ID, for `DocumentInfo.scannedPages`. */
export function loadScannedPages(
  db: AppDatabase,
  documentIds: readonly number[],
): Map<number, number[]> {
  const pages = new Map<number, number[]>()
  if (documentIds.length === 0) return pages
  const rows = db
    .select({ documentId: documentPages.documentId, pageNumber: documentPages.pageNumber })
    .from(documentPages)
    .where(
      and(inArray(documentPages.documentId, [...documentIds]), eq(documentPages.hasText, false)),
    )
    .orderBy(asc(documentPages.pageNumber))
    .all()
  for (const row of rows)
    pages.set(row.documentId, [...(pages.get(row.documentId) ?? []), row.pageNumber])
  return pages
}

function loadListingRows(
  db: AppDatabase,
  scope: readonly Bundesland[],
  basis: PriceBasis,
): ListingRow[] {
  if (scope.length === 0) return []
  const rows = db
    .select(listingColumns)
    .from(edicts)
    .where(and(isNull(edicts.removedAt), inArray(edicts.bundesland, [...scope])))
    .all()
  const users = new Map(
    db
      .select({ caseKey: userState.caseKey, starred: userState.starred, hidden: userState.hidden })
      .from(userState)
      .all()
      .map((state) => [state.caseKey, state]),
  )
  const withGutachten = new Set(
    db
      .selectDistinct({ edictId: documents.edictId })
      .from(documents)
      .where(eq(documents.kind, 'langgutachten'))
      .all()
      .map((document) => document.edictId),
  )
  const estimates = new Map<string, AreaEstimateRow[]>()
  for (const estimate of db.select().from(areaEstimates).orderBy(asc(areaEstimates.id)).all()) {
    estimates.set(estimate.edictId, [...(estimates.get(estimate.edictId) ?? []), estimate])
  }
  const statuses = new Map(
    db
      .select({ edictId: analyses.edictId, status: analyses.status })
      .from(analyses)
      .where(inArray(analyses.id, latestAnalysisIds(db)))
      .all()
      .map((analysis) => [analysis.edictId, analysis.status]),
  )
  const finished = new Map(
    db
      .select({
        edictId: analyses.edictId,
        result: analyses.result,
        evidence: analyses.evidence,
        documentIds: analyses.documentIds,
      })
      .from(analyses)
      .where(inArray(analyses.id, latestAnalysisIds(db, 'done')))
      .all()
      .map((analysis) => [analysis.edictId, toFinishedAnalysis(analysis)]),
  )
  return rows.map((edict) => {
    const user = users.get(edict.caseKey)
    const sources = {
      starred: user?.starred ?? false,
      hidden: user?.hidden ?? false,
      hasLanggutachten: withGutachten.has(edict.id),
      analysisStatus: statuses.get(edict.id) ?? null,
      finished: finished.get(edict.id) ?? null,
      estimates: estimates.get(edict.id) ?? [],
    }
    return buildListingRow(edict, sources, basis).row
  })
}

/** Subquery: the newest analysis ID per edict, optionally among those that are done. */
function latestAnalysisIds(db: AppDatabase, status?: 'done') {
  return db
    .select({ id: max(analyses.id) })
    .from(analyses)
    .where(status === undefined ? undefined : eq(analyses.status, status))
    .groupBy(analyses.edictId)
}

function latestAnalysis(
  db: AppDatabase,
  edictId: string,
  status?: 'done',
): AnalysisRow | undefined {
  return db
    .select()
    .from(analyses)
    .where(
      and(
        eq(analyses.edictId, edictId),
        status === undefined ? undefined : eq(analyses.status, status),
      ),
    )
    .orderBy(desc(analyses.id))
    .limit(1)
    .get()
}

/** Stored edicts of the same case or from the page's "Alle Edikte zum Fall" chain. */
function loadRelated(db: AppDatabase, edict: EdictRow): RelatedEdict[] {
  const sameCase = eq(edicts.caseKey, edict.caseKey)
  const linked =
    edict.relatedIds.length > 0 ? or(sameCase, inArray(edicts.id, edict.relatedIds)) : sameCase
  return db
    .select({
      id: edicts.id,
      noticeType: edicts.noticeType,
      status: edicts.status,
      publishedAt: edicts.publishedAt,
      auctionAt: edicts.auctionAt,
      url: edicts.url,
    })
    .from(edicts)
    .where(and(ne(edicts.id, edict.id), linked))
    .orderBy(asc(edicts.publishedAt), asc(edicts.id))
    .all()
}
