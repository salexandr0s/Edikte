import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ListingRow } from '@shared/domain'
import type { AnalysisPage } from '../../../src/main/ai/analysis/types'
import type { AppDatabase } from '../../../src/main/db/client'
import { createDocumentStore } from '../../../src/main/db/document-store'
import { documents, edicts } from '../../../src/main/db/schema'

// Rows for the document and analysis tests. Titles and addresses are invented.

export const NOW = '2026-11-05T08:00:00.000Z'

/** A valid edict ID: 32 lowercase hex characters. */
export function edictId(n: number): string {
  return n.toString(16).padStart(32, '0')
}

export function insertEdict(
  db: AppDatabase,
  id: string,
  values: Partial<typeof edicts.$inferInsert> = {},
): void {
  db.insert(edicts)
    .values({
      id,
      caseKey: `case-${id}`,
      noticeType: 'versteigerung',
      status: 'upcoming',
      url: 'https://edikte.justiz.gv.at/',
      propertyType: 'apartment',
      title: 'Eigentumswohnung Top 3',
      rawLabels: {},
      contentHash: 'hash',
      parserVersion: 1,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      fetchedAt: NOW,
      ...values,
    })
    .run()
}

/** A Langgutachten that has not been downloaded; returns its ID. */
export function insertGutachten(
  db: AppDatabase,
  edict: string,
  values: Partial<typeof documents.$inferInsert> = {},
): number {
  return db
    .insert(documents)
    .values({
      edictId: edict,
      kind: 'langgutachten',
      title: 'Langgutachten (pdf)',
      fileName: 'gutachten.pdf',
      url: `https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/0/${edict}/$file/gutachten.pdf`,
      statedSizeKb: 100,
      createdAt: NOW,
      ...values,
    })
    .returning({ id: documents.id })
    .get().id
}

/** Writes a stand-in PDF for the document and stores its pages as read. */
export async function storeReadDocument(
  db: AppDatabase,
  documentsDir: string,
  documentId: number,
  edict: string,
  pages: readonly AnalysisPage[],
): Promise<void> {
  const localPath = `${edict}/${documentId}-gutachten.pdf`
  await mkdir(path.join(documentsDir, edict), { recursive: true })
  await writeFile(path.join(documentsDir, localPath), '%PDF-1.4 stand-in')
  const store = createDocumentStore(db)
  store.recordDownload(documentId, { localPath, sha256: 'sha', bytes: 17, downloadedAt: NOW })
  store.recordPages(
    documentId,
    { pageCount: pages.length, extractedAt: NOW, extractError: null },
    pages.map((page) => ({ documentId, ...page })),
  )
}

/** A row as listings:query returns it; `area` in m², or null for none. */
export function listingRow(id: string, area: number | null): ListingRow {
  return {
    id,
    caseKey: `case-${id}`,
    url: 'https://edikte.justiz.gv.at/',
    status: 'upcoming',
    noticeType: 'versteigerung',
    title: 'Eigentumswohnung Top 3',
    categoryLabel: null,
    propertyType: 'apartment',
    street: null,
    plz: null,
    city: null,
    bundesland: 'wien',
    bezirk: null,
    court: null,
    caseNumber: null,
    auctionAt: null,
    publishedAt: null,
    schaetzwertEur: 200_000,
    geringstesGebotEur: null,
    area:
      area === null
        ? null
        : {
            sqm: area,
            kind: 'nutzflaeche',
            source: 'listing',
            page: null,
            quote: null,
            documentId: null,
          },
    plotSqm: null,
    priceBasis: 'schaetzwert',
    pricePerSqm: null,
    approximate: [],
    analysisStatus: null,
    hasAnalysis: false,
    riskLevel: null,
    hasLanggutachten: true,
    starred: false,
    hidden: false,
    removedAt: null,
  }
}
