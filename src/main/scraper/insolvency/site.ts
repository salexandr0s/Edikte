import type { Bundesland } from '@shared/enums'
import type { JsonSource } from '../client'
import type { KnownEdict } from '../sync'
import type { SiteRun, SyncListing, SyncSite } from '../sync-site'
import { insolvencyDetailUrl, insolvencySearchUrl } from './api'
import { parseInsolvencyDetail, type InsolvencyDetail } from './detail'
import {
  buildInsolvencyRecord,
  insolvencyContentHash,
  type ListedInsolvencyRow,
} from './edict-record'
import { INSOLVENCY_PARSER_VERSION } from './parser-version'
import { parseInsolvencySearchPage } from './search'

const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const HEALTH_LIMIT = 0.2
const VIENNA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Reads the public real-estate notices in the selected Bundesländer. */
export function createInsolvencySite(
  source: JsonSource,
): SyncSite<ListedInsolvencyRow, InsolvencyDetail> {
  return {
    source: 'insolvency_sale',
    parserVersion: INSOLVENCY_PARSER_VERSION,
    incrementalList: false,
    get requestCount() {
      return source.requestCount
    },
    list: (run) => listRows(run, source),
    needsPage,
    readPage: async (run, row) => {
      const detail = parseInsolvencyDetail(
        await source.getJson(insolvencyDetailUrl(row.recordNumber), run.signal),
        row.recordNumber,
      )
      if (detail.transaction === 'other') run.errors.push(`${row.id}: unknown transaction type`)
      if (detail.bundesland !== row.bundesland)
        run.errors.push(`${row.id}: listed and detail Bundesland differ`)
      if (detail.skippedFiles.foreignUrl > 0)
        run.errors.push(
          `${row.id}: skipped ${detail.skippedFiles.foreignUrl} files with invalid URLs`,
        )
      return detail
    },
    contentHash: insolvencyContentHash,
    finish: (run, changed) =>
      Promise.resolve(
        changed.map(({ row, page }) => ({
          edict: buildInsolvencyRecord({ detail: page, row, fetchedAt: run.now().toISOString() }),
          documents: page.documents,
        })),
      ),
    assessHealth: ({ rows, pages }) => {
      const notes: string[] = []
      const unreadableFiles = pages.reduce(
        (count, { page }) => count + page.skippedFiles.unreadable,
        0,
      )
      if (unreadableFiles > 0)
        notes.push(`${unreadableFiles} declared files or file lists could not be read`)
      const duplicates = rows.filter((row) => row.conflictingBundesland).length
      if (rows.length > 0 && duplicates / rows.length > HEALTH_LIMIT)
        notes.push(`${duplicates} of ${rows.length} records occur in different Bundesländer`)
      const invalid = pages.filter(
        ({ row, page }) =>
          page.court === null ||
          page.caseNumber === null ||
          page.plz === null ||
          page.bundesland !== row.bundesland,
      ).length
      if (pages.length > 0 && invalid / pages.length > HEALTH_LIMIT)
        notes.push(
          `${invalid} of ${pages.length} insolvency pages lack court, case number, postcode or a matching Bundesland`,
        )
      const missingSections = new Set(
        pages.flatMap(({ page }) =>
          page.missing.filter(
            (part) => !['court', 'caseNumber', 'plz', 'bundesland'].includes(part),
          ),
        ),
      )
      if (missingSections.size > 0)
        notes.push(`Known insolvency sections are missing: ${[...missingSections].join(', ')}`)
      const unknown = pages.filter(({ page }) => page.transaction === 'other').length
      if (pages.length > 0 && unknown / pages.length > HEALTH_LIMIT)
        notes.push(
          `${unknown} of ${pages.length} insolvency pages have an unknown transaction type`,
        )
      return notes.length > 0 ? notes.join('; ') : null
    },
  }
}

function needsPage(run: SiteRun, row: ListedInsolvencyRow, known: KnownEdict | undefined): boolean {
  if (
    known === undefined ||
    known.removedAt !== null ||
    known.parserVersion < INSOLVENCY_PARSER_VERSION ||
    known.contentHash === ''
  )
    return true
  return (
    (row.updatedAt ?? row.publishedAt) >= viennaDay(known.fetchedAt) ||
    Date.parse(run.startedAt) - Date.parse(known.fetchedAt) >= REFRESH_AFTER_MS
  )
}

function viennaDay(at: string): string {
  const parts = VIENNA_DAY.formatToParts(new Date(at))
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

async function listRows(
  run: SiteRun,
  source: JsonSource,
): Promise<SyncListing<ListedInsolvencyRow>> {
  const rows = new Map<string, ListedInsolvencyRow>()
  const incomplete: string[] = []
  for (const [index, bundesland] of run.scope.entries()) {
    run.report('list', index, run.scope.length)
    let result = await listLand(run, source, bundesland)
    // A changing result set can shift rows between pages. Retry the entire Land
    // before trusting its count, and compare before deduplication across Länder.
    if (result.incomplete !== null) result = await listLand(run, source, bundesland)
    if (result.incomplete !== null) incomplete.push(result.incomplete)
    for (const message of result.errors) run.errors.push(`List ${bundesland}: ${message}`)
    for (const row of result.rows.values()) {
      const before = rows.get(row.id)
      if (before === undefined) rows.set(row.id, row)
      else if (before.bundesland !== bundesland) {
        before.conflictingBundesland = true
        run.errors.push(`${row.id}: listed in more than one Bundesland`)
      }
    }
  }
  return { rows, incomplete: incomplete.length > 0 ? incomplete.join('; ') : null }
}

interface LandListing extends SyncListing<ListedInsolvencyRow> {
  errors: string[]
}

async function listLand(
  run: SiteRun,
  source: JsonSource,
  bundesland: Bundesland,
): Promise<LandListing> {
  const rows = new Map<string, ListedInsolvencyRow>()
  const errors: string[] = []
  let expected: number | null = null
  let count = 0
  let incomplete = false
  let pages = 1
  for (let page = 1; page <= pages; page += 1) {
    const result = parseInsolvencySearchPage(
      await source.getJson(insolvencySearchUrl({ bundesland, page }), run.signal),
    )
    expected ??= result.total
    if (page === 1) pages = Math.max(1, Math.ceil(result.total / result.pageSize))
    if (result.page !== page || result.total !== expected || result.incomplete) incomplete = true
    count += result.rows.length + result.skipped.length
    errors.push(...result.skipped)
    for (const row of result.rows) {
      if (rows.has(row.id)) incomplete = true
      rows.set(row.id, { ...row, bundesland, conflictingBundesland: false })
    }
    if (
      result.page !== page ||
      (result.rows.length === 0 && result.skipped.length === 0 && count < expected)
    ) {
      incomplete = true
      break
    }
  }
  if (count !== expected || rows.size !== count || errors.length > 0) incomplete = true
  return {
    rows,
    errors,
    incomplete: incomplete
      ? `${bundesland}: the JustizOnline list is incomplete (${rows.size} of ${expected ?? 0} readable records)`
      : null,
  }
}
