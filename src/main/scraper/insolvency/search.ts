import { insolvencyEdictId } from '@shared/edict-id'
import { AppError } from '@shared/errors'
import {
  InsolvencySearchEnvelopeSchema,
  InsolvencySearchRowSchema,
  publishedText,
  withIssueFields,
} from './api'

export interface InsolvencySearchRow {
  recordNumber: number
  /** Stored edict ID, `mv-<record number>`. */
  id: string
  /** Vienna date, "YYYY-MM-DD". */
  publishedAt: string
  /** Date of the last change; null for a record that was never changed. */
  updatedAt: string | null
  caseNumber: string | null
  /** Court as the list names it, without its code. */
  court: string | null
}

export interface InsolvencySearchPage {
  rows: InsolvencySearchRow[]
  /** Matches the API reports for the whole search, over all pages. */
  total: number
  /**
   * The API's `incompleteResult`. What `total` counts in that case is not
   * known, so such a list must not be taken for a complete one.
   */
  incomplete: boolean
  page: number
  pageSize: number
  /** Why each unreadable row was left out. */
  skipped: string[]
}

/**
 * Reads one page of the JustizOnline search. Each row is checked on its own:
 * an unreadable row is left out and noted in `skipped`, so the caller can see
 * that it got fewer rows than the page held.
 */
export function parseInsolvencySearchPage(json: unknown): InsolvencySearchPage {
  const envelope = InsolvencySearchEnvelopeSchema.safeParse(json)
  if (!envelope.success) {
    throw new AppError(
      'site_changed',
      withIssueFields('The JustizOnline search answer has an unknown layout', envelope.error),
    )
  }
  const { page, pageSize, total, incompleteResult, edikte } = envelope.data
  const rows: InsolvencySearchRow[] = []
  const skipped: string[] = []
  for (const [index, candidate] of edikte.entries()) {
    const row = InsolvencySearchRowSchema.safeParse(candidate)
    if (!row.success) {
      skipped.push(withIssueFields(`Search row ${index + 1} could not be read`, row.error))
      continue
    }
    rows.push({
      recordNumber: row.data.id,
      id: insolvencyEdictId(row.data.id),
      publishedAt: row.data.publishedAt,
      updatedAt: row.data.updatedAt ?? null,
      caseNumber: publishedText(row.data.aktenzeichen),
      court: publishedText(row.data.publisherInfo),
    })
  }
  return { rows, total, incomplete: incompleteResult, page, pageSize, skipped }
}
