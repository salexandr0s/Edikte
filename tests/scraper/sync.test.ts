import { describe, expect, it } from 'vitest'
import type { SyncRunSummary, SyncStatus } from '@shared/domain'
import type { Bundesland } from '@shared/enums'
import { AppError } from '@shared/errors'
import type { PageSource } from '../../src/main/scraper/client'
import type { DocumentLink } from '../../src/main/scraper/detail'
import type { EdictRecord } from '../../src/main/scraper/edict-record'
import { PARSER_VERSION } from '../../src/main/scraper/parser-version'
import {
  runSync,
  type KnownEdict,
  type SyncCommit,
  type SyncOptions,
  type SyncRunStart,
  type SyncStore,
  type SyncStoreState,
} from '../../src/main/scraper/sync'

const HOUR = 60 * 60 * 1000

interface SitePage {
  id: string
  title: string
  caseNumber: string | null
  schaetzwert: string | null
  /** Heading before the title; "Versteigerung" when not set. */
  notice?: string
}

const idOf = (n: number) => n.toString(16).padStart(32, '0')

function edict(n: number, changes: Partial<SitePage> = {}): SitePage {
  return {
    id: idOf(n),
    title: `Wohnung Top ${n}`,
    caseNumber: `1 E ${n}/26a`,
    schaetzwert: '100.000,00',
    ...changes,
  }
}

function labelRow(label: string, value: string): string {
  return `<div class="row"><span>${label}:</span><p>${value}</p></div>`
}

function listHtml(pages: readonly SitePage[]): string {
  const rows = pages
    .map(
      (page) =>
        `<tr><td></td><td><a href="alldoc/${page.id}!OpenDocument">Versteigerung (01.12.2026)</a></td>` +
        `<td>1030 Wien Musterstraße 1<br>Eigentumswohnung</td><td>${page.title}</td></tr>`,
    )
    .join('')
  return `<input name="Hits" value="${pages.length}"><input name="TotalHits" value="${pages.length}"><table><tbody>${rows}</tbody></table>`
}

function detailHtml(page: SitePage): string {
  return [
    `<div id="druckbereich"><h1><small>${page.notice ?? 'Versteigerung'} - ${page.title}</small></h1>`,
    labelRow('Dienststelle', 'BG Musterstadt (099)'),
    page.caseNumber === null ? '' : labelRow('Aktenzeichen', page.caseNumber),
    labelRow('Versteigerungstermin', 'am 01.12.2026 um 10:00 Uhr'),
    labelRow('PLZ/Ort', '1030 Wien'),
    labelRow('Kategorie(n)', 'Eigentumswohnung'),
    page.schaetzwert === null ? '' : labelRow('Schätzwert', `${page.schaetzwert} EUR`),
    labelRow(
      'Kurzgutachten',
      `<a href="/edikte/ex/exedi3.nsf/0/f${page.id.slice(1)}">Kurzgutachten</a>`,
    ),
    labelRow(
      'Langgutachten',
      `<a href="/edikte/ex/exedi3.nsf/0/${page.id}/$file/gutachten.pdf">Langgutachten (pdf) (100 KB)</a>`,
    ),
    '</div>',
  ].join('')
}

const KURZGUTACHTEN_HTML = `<div id="druckbereich">${labelRow('Anschlüsse', 'Strom')}${labelRow('Stichtag', '1.10.2026')}</div>`

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new AppError('cancelled', 'Cancelled')
}

/** The site as seen through the client: lists, edict pages and Kurzgutachten pages. */
class FakeSite implements PageSource {
  requestCount = 0
  readonly urls: string[] = []
  readonly pages = new Map<string, SitePage>()
  listed: SitePage[] = []
  /** Runs before each answer; throws to simulate a failure. */
  beforeAnswer: (url: string) => void = () => undefined

  publish(...pages: SitePage[]): void {
    for (const page of pages) this.pages.set(page.id, page)
    this.listed = [...this.pages.values()]
  }

  getText(url: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve) => {
      throwIfCancelled(signal)
      this.requestCount += 1
      this.urls.push(url)
      this.beforeAnswer(url)
      throwIfCancelled(signal)
      resolve(this.#answer(url))
    })
  }

  listUrls(): string[] {
    return this.urls
      .filter((url) => url.includes('/suchedi?'))
      .map((url) => decodeURIComponent(url))
  }

  #answer(url: string): string {
    if (url.includes('/suchedi?')) return listHtml(this.listed)
    const detail = /alldoc\/([0-9a-f]{32})!OpenDocument$/.exec(url)
    if (detail !== null) {
      const page = this.pages.get(detail[1] ?? '')
      if (page === undefined) throw new AppError('not_found', 'HTTP 404 from the site')
      return detailHtml(page)
    }
    if (/\/0\/[0-9a-f]{32}$/.test(url)) return KURZGUTACHTEN_HTML
    throw new Error(`Unexpected URL ${url}`)
  }
}

type StoredRun = SyncRunSummary & { scope: Bundesland[]; errors: string[] }

/** In-memory SyncStore with the semantics the database store must have. */
class MemoryStore implements SyncStore {
  readonly edicts = new Map<string, EdictRecord>()
  readonly documents = new Map<string, DocumentLink[]>()
  readonly runs: StoredRun[] = []
  readonly commits: SyncCommit[] = []

  loadState(scope: readonly Bundesland[]): SyncStoreState {
    const known = new Map<string, KnownEdict>()
    for (const edict of this.edicts.values()) {
      if (edict.bundesland === null || !scope.includes(edict.bundesland)) continue
      known.set(edict.id, {
        id: edict.id,
        noticeType: edict.noticeType,
        bundesland: edict.bundesland,
        contentHash: edict.contentHash,
        parserVersion: edict.parserVersion,
        auctionAt: edict.auctionAt,
        fetchedAt: edict.fetchedAt,
        removedAt: edict.removedAt,
      })
    }
    const ok = this.runs.filter((run) => run.status === 'ok')
    return {
      known,
      lastOkRunStartedAt: ok.at(-1)?.startedAt ?? null,
      lastOkFullRunStartedAt: ok.filter((run) => run.kind === 'full').at(-1)?.startedAt ?? null,
      lastFinished: this.runs.filter((run) => run.finishedAt !== null).at(-1) ?? null,
    }
  }

  startRun(run: SyncRunStart): number {
    const id = this.runs.length + 1
    this.runs.push({
      id,
      kind: run.kind,
      status: 'running',
      startedAt: run.startedAt,
      finishedAt: null,
      listed: 0,
      fetched: 0,
      changed: 0,
      removed: 0,
      requests: 0,
      note: null,
      scope: run.scope,
      errors: [],
    })
    return id
  }

  commitRun(commit: SyncCommit): void {
    this.commits.push(commit)
    const run = this.runs.find((entry) => entry.id === commit.summary.id)
    if (run !== undefined) Object.assign(run, commit.summary, { errors: commit.errors })
    for (const { edict, documents } of commit.upserts) {
      const existing = this.edicts.get(edict.id)
      this.edicts.set(edict.id, {
        ...edict,
        firstSeenAt: existing?.firstSeenAt ?? edict.firstSeenAt,
      })
      this.documents.set(edict.id, documents)
    }
    for (const id of commit.seenIds) this.#patch(id, { lastSeenAt: commit.at })
    for (const id of commit.unchangedIds)
      this.#patch(id, { lastSeenAt: commit.at, fetchedAt: commit.at })
    for (const id of commit.removedIds) this.#patch(id, { removedAt: commit.at })
  }

  #patch(id: string, values: Partial<EdictRecord>): void {
    const edict = this.edicts.get(id)
    if (edict !== undefined) this.edicts.set(id, { ...edict, ...values })
  }
}

function setup(...pages: SitePage[]) {
  const site = new FakeSite()
  site.publish(...pages)
  const store = new MemoryStore()
  let time = Date.parse('2026-11-04T08:00:00.000Z')
  const statuses: SyncStatus[] = []
  const sync = (options: Partial<SyncOptions> = {}) =>
    runSync({
      source: site,
      store,
      scope: ['wien'],
      now: () => new Date(time),
      onProgress: (status) => statuses.push(status),
      ...options,
    })
  const advance = (ms: number) => {
    time += ms
  }
  const now = () => new Date(time).toISOString()
  return { site, store, statuses, sync, advance, now }
}

describe('runSync', () => {
  it('reads every listed page and its Kurzgutachten on the first run', async () => {
    const { site, store, statuses, sync } = setup(edict(1), edict(2))
    const summary = await sync()
    expect(summary).toMatchObject({
      kind: 'full',
      status: 'ok',
      listed: 2,
      fetched: 2,
      changed: 2,
      removed: 0,
      requests: 5,
      note: null,
    })
    expect(site.listUrls()).toEqual([expect.stringContaining('query=([BL]=(0))')])
    expect(store.edicts.get(idOf(1))).toMatchObject({
      caseNumber: '1 E 1/26a',
      schaetzwertEur: 100000,
      bundesland: 'wien',
      bezirk: 3,
      kurzgutachten: { anschluesse: 'Strom', stichtag: '2026-10-01' },
      parserVersion: PARSER_VERSION,
    })
    expect(store.documents.get(idOf(1))).toMatchObject([
      { kind: 'langgutachten', statedSizeKb: 100 },
    ])
    expect(new Set(statuses.map((status) => status.phase))).toEqual(
      new Set(['list', 'details', 'kurzgutachten', null]),
    )
    expect(statuses.at(-1)).toMatchObject({
      state: 'idle',
      current: null,
      lastFinished: { status: 'ok' },
    })
  })

  it('lists only recent edicts within a day and reads their pages', async () => {
    const { site, store, sync, advance } = setup(edict(1))
    await sync()
    advance(6 * HOUR)
    site.pages.set(idOf(2), edict(2))
    site.listed = [edict(2)]
    const summary = await sync()
    expect(summary).toMatchObject({
      kind: 'incremental',
      status: 'ok',
      listed: 1,
      changed: 1,
      removed: 0,
    })
    expect(site.listUrls().at(-1)).toContain('AND ([DATBM]>=03.11.2026)')
    expect(store.edicts.get(idOf(1))?.removedAt).toBeNull()
    expect(store.edicts.has(idOf(2))).toBe(true)
  })

  it('skips pages whose content did not change', async () => {
    const { site, store, sync, advance } = setup(edict(1))
    await sync()
    advance(HOUR)
    const before = site.requestCount
    const summary = await sync()
    expect(summary).toMatchObject({ kind: 'incremental', status: 'ok', fetched: 1, changed: 0 })
    expect(site.requestCount - before).toBe(2)
    expect(store.commits.at(-1)?.unchangedIds).toEqual([idOf(1)])
  })

  it('marks edicts missing from the daily full list as removed', async () => {
    const { site, store, sync, advance, now } = setup(edict(1), edict(2))
    await sync()
    advance(25 * HOUR)
    site.pages.delete(idOf(2))
    site.listed = [edict(1)]
    const before = site.requestCount
    const summary = await sync()
    expect(summary).toMatchObject({ kind: 'full', status: 'ok', listed: 1, fetched: 0, removed: 1 })
    expect(site.requestCount - before).toBe(1)
    expect(store.edicts.get(idOf(2))?.removedAt).toBe(now())
    expect(store.edicts.get(idOf(1))).toMatchObject({ removedAt: null, lastSeenAt: now() })
  })

  it('does not trust a full list that drops most known edicts', async () => {
    const pages = Array.from({ length: 12 }, (_, index) => edict(index + 1))
    const { site, store, sync, advance } = setup(...pages)
    await sync()
    advance(25 * HOUR)
    site.listed = []
    const summary = await sync()
    expect(summary).toMatchObject({ kind: 'full', status: 'degraded', removed: 0 })
    expect([...store.edicts.values()].every((edict) => edict.removedAt === null)).toBe(true)
  })

  it('writes nothing when too many auction pages lack the Schätzwert', async () => {
    const pages = Array.from({ length: 6 }, (_, index) => edict(index + 1))
    const { site, store, sync, advance } = setup(...pages)
    await sync()
    advance(HOUR)
    site.publish(...pages.map((page) => ({ ...page, schaetzwert: null })))
    const summary = await sync()
    expect(summary).toMatchObject({
      kind: 'incremental',
      status: 'degraded',
      fetched: 6,
      changed: 0,
    })
    expect(summary.note).toContain('Schätzwert')
    expect([...store.edicts.values()].every((edict) => edict.schaetzwertEur === 100000)).toBe(true)
    expect(store.runs.at(-1)).toMatchObject({ status: 'degraded' })
  })

  it('logs a page deleted after listing and finishes the run', async () => {
    const { site, store, sync } = setup(edict(1), edict(2))
    site.listed = [...site.listed, edict(3)]
    const summary = await sync()
    expect(summary).toMatchObject({ status: 'ok', listed: 3, fetched: 2, changed: 2 })
    expect(store.runs[0]?.errors).toEqual([`${idOf(3)}: not_found: HTTP 404 from the site`])
  })

  it('fails without writing when the site is unavailable', async () => {
    const { site, store, sync } = setup(edict(1))
    site.beforeAnswer = (url) => {
      if (url.includes('alldoc/')) throw new AppError('site_unavailable', 'HTTP 503 from the site')
    }
    const summary = await sync()
    expect(summary).toMatchObject({ status: 'failed', changed: 0 })
    expect(summary.note).toContain('site_unavailable')
    expect(store.commits.at(-1)?.failureCode).toBe('site_unavailable')
    expect(store.edicts.size).toBe(0)
  })

  it('logs unknown headings and writes nothing when many pages have one', async () => {
    const pages = Array.from({ length: 6 }, (_, index) => edict(index + 1))
    const { site, store, sync, advance } = setup(...pages)
    await sync()
    advance(HOUR)
    site.publish(...pages.map((page) => ({ ...page, notice: 'Kundmachung' })))
    const summary = await sync()
    expect(summary).toMatchObject({ kind: 'incremental', status: 'degraded', changed: 0 })
    expect(summary.note).toContain('unknown heading')
    expect(store.runs.at(-1)?.errors).toContain(`${idOf(1)}: unknown notice "Kundmachung"`)
  })

  it('reads every page again with a full run after a parser update', async () => {
    const { store, sync, advance } = setup(edict(1))
    await sync()
    advance(HOUR)
    for (const [id, stored] of store.edicts) {
      store.edicts.set(id, { ...stored, parserVersion: PARSER_VERSION - 1 })
    }
    const summary = await sync()
    expect(summary).toMatchObject({ kind: 'full', status: 'ok', fetched: 1, changed: 1 })
    expect(store.edicts.get(idOf(1))?.parserVersion).toBe(PARSER_VERSION)
  })

  it('stops and writes nothing when cancelled', async () => {
    const { site, store, statuses, sync } = setup(edict(1), edict(2), edict(3))
    const controller = new AbortController()
    site.beforeAnswer = (url) => {
      if (url.includes(`alldoc/${idOf(2)}`)) controller.abort()
    }
    const summary = await sync({ signal: controller.signal })
    expect(summary).toMatchObject({ status: 'cancelled', changed: 0, note: null })
    expect(store.commits.at(-1)?.failureCode).toBeNull()
    expect(store.edicts.size).toBe(0)
    expect(store.runs[0]?.status).toBe('cancelled')
    expect(statuses.at(-1)).toMatchObject({ state: 'idle', lastFinished: { status: 'cancelled' } })
  })
})
