import { and, asc, eq, inArray, isNotNull, isNull, min, ne, or } from 'drizzle-orm'
import type { DocumentInfo } from '@shared/domain'
import type { ListingStatus } from '@shared/enums'
import type { AnalysisPage, EdictFacts } from '../ai/analysis/types'
import type { DocumentStore, PipelineDocument } from '../documents/pipeline'
import type { RetentionCandidate } from '../documents/retention'
import type { AppDatabase } from './client'
import { toDocumentInfo, type DocumentRow } from './records'
import { areaEstimates, documentPages, documents, edicts, userState } from './schema'

// Documents, their page texts and local m² estimates. The download pipeline
// (src/main/documents/pipeline.ts) writes through the DocumentStore methods.

/** A document with the edict facts that downloads, estimates and analyses need. */
export interface StoredDocument {
  row: DocumentRow
  info: DocumentInfo
  facts: EdictFacts
  edictTitle: string
}

/** DocumentStore with synchronous writes, plus the lookups of the document and analysis services. */
export interface AppDocumentStore {
  recordDownload(documentId: number, patch: Parameters<DocumentStore['recordDownload']>[1]): void
  recordPages(
    documentId: number,
    patch: Parameters<DocumentStore['recordPages']>[1],
    pages: Parameters<DocumentStore['recordPages']>[2],
  ): void
  recordExtractError(
    documentId: number,
    patch: Parameters<DocumentStore['recordExtractError']>[1],
  ): void
  replaceEstimates(documentId: number, rows: Parameters<DocumentStore['replaceEstimates']>[1]): void
  /** A document with its edict; null when there is no such document. */
  find(documentId: number): StoredDocument | null
  edictIdOf(documentId: number): string | null
  /** Each edict's first still-published Langgutachten, ordered by ID. */
  langgutachten(edictIds: readonly string[]): Map<string, DocumentRow>
  /** Active reports with local estimates made from other or unknown bytes. */
  staleEstimateDocuments(documentIds: readonly number[]): Set<number>
  /** Every page of a read document, in page order. */
  pageTexts(documentId: number): AnalysisPage[]
  /** Every stored file, with the day its case closed and whether the user keeps it. */
  retentionCandidates(): RetentionCandidate[]
  /**
   * Forgets cached files and page texts, retaining the content hash that
   * identifies saved results. Returns the edicts whose documents changed.
   */
  clearDownloads(documentIds: readonly number[]): string[]
}

/** Rows per INSERT, far below SQLite's limit on bound parameters. */
const INSERT_BATCH = 200
const OPEN_STATUSES: ReadonlySet<ListingStatus> = new Set(['upcoming', 'postponed', 'on_offer'])

const factColumns = {
  source: edicts.source,
  categoryLabel: edicts.categoryLabel,
  propertyType: edicts.propertyType,
  street: edicts.street,
  plz: edicts.plz,
  city: edicts.city,
  schaetzwertEur: edicts.schaetzwertEur,
  objektgroesseSqm: edicts.objektgroesseSqm,
}

interface CaseEdict {
  status: ListingStatus
  publishedAt: string | null
  auctionAt: string | null
  removedAt: string | null
}

/** Subquery: the first still-published report of each edict. */
export function activeReportIds(db: AppDatabase) {
  return db
    .select({ id: min(documents.id) })
    .from(documents)
    .where(and(eq(documents.kind, 'langgutachten'), isNull(documents.removedAt)))
    .groupBy(documents.edictId)
}

export function loadActiveReports(
  db: AppDatabase,
  edictIds: readonly string[],
): Map<string, DocumentRow> {
  if (edictIds.length === 0) return new Map()
  return new Map(
    db
      .select()
      .from(documents)
      .where(
        and(inArray(documents.edictId, [...edictIds]), inArray(documents.id, activeReportIds(db))),
      )
      .orderBy(asc(documents.id))
      .all()
      .map((row) => [row.edictId, row]),
  )
}

export function createDocumentStore(db: AppDatabase): AppDocumentStore {
  const scannedPages = (documentId: number): number[] =>
    db
      .select({ page: documentPages.pageNumber })
      .from(documentPages)
      .where(and(eq(documentPages.documentId, documentId), eq(documentPages.hasText, false)))
      .orderBy(asc(documentPages.pageNumber))
      .all()
      .map((row) => row.page)

  return {
    recordDownload(documentId, patch) {
      db.transaction((tx) => {
        const previous = tx
          .select({ sha256: documents.sha256 })
          .from(documents)
          .where(eq(documents.id, documentId))
          .get()
        const changed = previous?.sha256 !== patch.sha256
        if (changed) {
          tx.delete(documentPages).where(eq(documentPages.documentId, documentId)).run()
        }
        tx.update(documents)
          .set({
            ...patch,
            ...(changed ? { pageCount: null, extractedAt: null, extractError: null } : {}),
          })
          .where(eq(documents.id, documentId))
          .run()
      })
    },
    recordPages(documentId, patch, pages) {
      db.transaction((tx) => {
        tx.delete(documentPages).where(eq(documentPages.documentId, documentId)).run()
        for (let start = 0; start < pages.length; start += INSERT_BATCH) {
          tx.insert(documentPages)
            .values(pages.slice(start, start + INSERT_BATCH))
            .run()
        }
        tx.update(documents).set(patch).where(eq(documents.id, documentId)).run()
      })
    },
    recordExtractError(documentId, patch) {
      db.update(documents).set(patch).where(eq(documents.id, documentId)).run()
    },
    replaceEstimates(documentId, rows) {
      db.transaction((tx) => {
        const document = tx
          .select({ sha256: documents.sha256 })
          .from(documents)
          .where(eq(documents.id, documentId))
          .get()
        tx.delete(areaEstimates).where(eq(areaEstimates.documentId, documentId)).run()
        if (rows.length > 0) {
          tx.insert(areaEstimates)
            .values(rows.map((row) => ({ ...row, documentSha256: document?.sha256 ?? null })))
            .run()
        }
      })
    },
    find(documentId) {
      const found = db
        .select({ row: documents, edictTitle: edicts.title, ...factColumns })
        .from(documents)
        .innerJoin(edicts, eq(edicts.id, documents.edictId))
        .where(eq(documents.id, documentId))
        .get()
      if (found === undefined) return null
      const { row, edictTitle, ...facts } = found
      return { row, edictTitle, facts, info: toDocumentInfo(row, scannedPages(row.id)) }
    },
    edictIdOf(documentId) {
      const found = db
        .select({ edictId: documents.edictId })
        .from(documents)
        .where(eq(documents.id, documentId))
        .get()
      return found?.edictId ?? null
    },
    langgutachten: (edictIds) => loadActiveReports(db, edictIds),
    staleEstimateDocuments(documentIds) {
      if (documentIds.length === 0) return new Set()
      const rows = db
        .selectDistinct({ id: documents.id })
        .from(areaEstimates)
        .innerJoin(
          documents,
          and(
            eq(documents.id, areaEstimates.documentId),
            eq(documents.edictId, areaEstimates.edictId),
          ),
        )
        .where(
          and(
            inArray(documents.id, [...documentIds]),
            inArray(documents.id, activeReportIds(db)),
            or(
              isNull(documents.sha256),
              isNull(areaEstimates.documentSha256),
              ne(areaEstimates.documentSha256, documents.sha256),
            ),
          ),
        )
        .all()
      return new Set(rows.map((row) => row.id))
    },
    pageTexts(documentId) {
      return db
        .select({
          pageNumber: documentPages.pageNumber,
          printedLabel: documentPages.printedLabel,
          hasText: documentPages.hasText,
          text: documentPages.text,
        })
        .from(documentPages)
        .where(eq(documentPages.documentId, documentId))
        .orderBy(asc(documentPages.pageNumber))
        .all()
    },
    retentionCandidates() {
      const stored = db
        .select({
          documentId: documents.id,
          localPath: documents.localPath,
          caseKey: edicts.caseKey,
        })
        .from(documents)
        .innerJoin(edicts, eq(edicts.id, documents.edictId))
        .where(isNotNull(documents.localPath))
        .orderBy(asc(documents.id))
        .all()
      if (stored.length === 0) return []
      const caseKeys = [...new Set(stored.map((document) => document.caseKey))]
      const cases = new Map<string, CaseEdict[]>()
      const caseEdicts = db
        .select({
          caseKey: edicts.caseKey,
          status: edicts.status,
          publishedAt: edicts.publishedAt,
          auctionAt: edicts.auctionAt,
          removedAt: edicts.removedAt,
        })
        .from(edicts)
        .where(inArray(edicts.caseKey, caseKeys))
        .all()
      for (const edict of caseEdicts) {
        cases.set(edict.caseKey, [...(cases.get(edict.caseKey) ?? []), edict])
      }
      const starred = new Set(
        db
          .select({ caseKey: userState.caseKey })
          .from(userState)
          .where(and(eq(userState.starred, true), inArray(userState.caseKey, caseKeys)))
          .all()
          .map((row) => row.caseKey),
      )
      return stored.map((document) => ({
        documentId: document.documentId,
        localPath: document.localPath,
        caseClosedAt: caseClosedAt(cases.get(document.caseKey) ?? []),
        keep: starred.has(document.caseKey),
      }))
    },
    clearDownloads(documentIds) {
      if (documentIds.length === 0) return []
      const ids = [...documentIds]
      const touched = db.transaction((tx) => {
        tx.delete(documentPages).where(inArray(documentPages.documentId, ids)).run()
        return tx
          .update(documents)
          .set({
            localPath: null,
            // The hash identifies saved results after the cached bytes expire.
            bytes: null,
            downloadedAt: null,
            pageCount: null,
            extractedAt: null,
            extractError: null,
          })
          .where(inArray(documents.id, ids))
          .returning({ edictId: documents.edictId })
          .all()
      })
      return [...new Set(touched.map((row) => row.edictId))]
    },
  }
}

/** The fields processDocument needs. */
export function toPipelineDocument({ row, facts }: StoredDocument): PipelineDocument {
  return {
    id: row.id,
    edictId: row.edictId,
    propertyType: facts.propertyType,
    url: row.url,
    fileName: row.fileName,
    statedSizeKb: row.statedSizeKb,
    localPath: row.localPath,
  }
}

/**
 * When a case closed: the latest date one of its edicts carries (published,
 * auction day or removal from the site). Null while an edict is still open.
 */
function caseClosedAt(caseEdicts: readonly CaseEdict[]): string | null {
  let closedAt: string | null = null
  let closedTime = Number.NEGATIVE_INFINITY
  for (const edict of caseEdicts) {
    if (edict.removedAt === null && OPEN_STATUSES.has(edict.status)) return null
    const auctionDay = edict.auctionAt?.slice(0, 10) ?? null
    for (const date of [edict.publishedAt, auctionDay, edict.removedAt]) {
      if (date === null) continue
      const time = Date.parse(date)
      if (time > closedTime) {
        closedAt = date
        closedTime = time
      }
    }
  }
  return closedAt
}
