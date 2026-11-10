import type { KurzgutachtenFacts } from '@shared/domain'
import type { PageSource } from './client'
import { parseDetailPage, type ParsedDetail } from './detail'
import { buildEdictRecord } from './edict-record'
import { assessRunHealth } from './health'
import { parseKurzgutachten } from './kurzgutachten'
import { PARSER_VERSION } from './parser-version'
import { SEARCH_MAX, buildSearchUrl, parseSearchResults, type SearchRow } from './search'
import type { EdictWrite, KnownEdict } from './sync'
import type { ChangedPage, SiteRun, SyncListing, SyncSite } from './sync-site'

const DAY_MS = 24 * 60 * 60 * 1000
const REFRESH_AFTER_MS = 7 * DAY_MS

/** Court auctions retain their existing list, refresh and health rules. */
export function createAuctionSite(source: PageSource): SyncSite<SearchRow, ParsedDetail> {
  return {
    source: 'court_auction',
    parserVersion: PARSER_VERSION,
    incrementalList: true,
    get requestCount() {
      return source.requestCount
    },
    list: (run) => listRows(run, source),
    needsPage,
    readPage: async (run, row) => {
      const detail = parseDetailPage(await source.getText(row.url, run.signal))
      if (detail.noticeType === 'other')
        run.errors.push(`${row.id}: unknown notice "${detail.noticeText}"`)
      return detail
    },
    contentHash: (detail) => detail.contentHash,
    finish: (run, changed) => readKurzgutachtenPages(run, source, changed),
    assessHealth: ({ pages }) =>
      assessRunHealth(
        pages.map(({ row, page }) => ({
          noticeType: page.noticeType === 'other' ? row.noticeType : page.noticeType,
          unknownNotice: page.noticeType === 'other',
          caseNumber: page.fields.caseNumber,
          schaetzwertEur: page.fields.schaetzwertEur,
        })),
      ).note,
  }
}

async function listRows(run: SiteRun, source: PageSource): Promise<SyncListing<SearchRow>> {
  const since = run.kind === 'incremental' ? incrementalSince(run) : undefined
  const rows = new Map<string, SearchRow>()
  let cutOff = false
  let skipped = 0
  for (const [index, bundesland] of run.scope.entries()) {
    run.report('list', index, run.scope.length)
    const url = buildSearchUrl({ bundesland, publishedSince: since })
    const result = parseSearchResults(await source.getText(url, run.signal), bundesland)
    if (result.totalHits > result.rows.length + result.skipped.length) cutOff = true
    skipped += result.skipped.length
    for (const message of result.skipped) run.errors.push(`List ${bundesland}: ${message}`)
    for (const row of result.rows) rows.set(row.id, row)
  }
  let incomplete: string | null = null
  if (cutOff) incomplete = `The site list stops at ${SEARCH_MAX} entries`
  else if (skipped > 0) incomplete = `${skipped} list rows could not be read`
  return { rows, incomplete }
}

function needsPage(run: SiteRun, row: SearchRow, known: KnownEdict | undefined): boolean {
  if (run.kind === 'incremental' || known === undefined) return true
  return (
    known.removedAt !== null ||
    known.contentHash === '' ||
    known.parserVersion < PARSER_VERSION ||
    known.noticeType !== row.noticeType ||
    (row.eventDate !== null &&
      known.auctionAt !== null &&
      !known.auctionAt.startsWith(row.eventDate)) ||
    Date.parse(run.startedAt) - Date.parse(known.fetchedAt) >= REFRESH_AFTER_MS
  )
}

async function readKurzgutachtenPages(
  run: SiteRun,
  source: PageSource,
  changed: readonly ChangedPage<SearchRow, ParsedDetail>[],
): Promise<EdictWrite[]> {
  const total = changed.filter(({ page }) => page.kurzgutachtenUrl !== null).length
  const fetchedAt = run.now().toISOString()
  const writes: EdictWrite[] = []
  let done = 0
  for (const { row, page: detail } of changed) {
    let kurzgutachten: KurzgutachtenFacts | null = null
    let complete = true
    const url = detail.kurzgutachtenUrl
    if (url !== null) {
      run.report('kurzgutachten', done, total)
      done += 1
      const page = await run.attempt(row.id, async () =>
        parseKurzgutachten(await source.getText(url, run.signal)),
      )
      if (page.ok) kurzgutachten = page.value
      else complete = page.gone
    }
    const edict = buildEdictRecord({ id: row.id, detail, row, kurzgutachten, fetchedAt })
    writes.push({
      edict: complete ? edict : { ...edict, contentHash: '' },
      documents: detail.documents,
    })
  }
  if (total > 0) run.report('kurzgutachten', total, total)
  return writes
}

const VIENNA_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Start one Vienna day before the last successful run. */
function incrementalSince(run: SiteRun): string | undefined {
  if (run.state.lastOkRunStartedAt === null) return undefined
  const parts = VIENNA_DAY.formatToParts(
    new Date(Date.parse(run.state.lastOkRunStartedAt) - DAY_MS),
  )
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
