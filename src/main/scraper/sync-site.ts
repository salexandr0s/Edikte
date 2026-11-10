import type { Bundesland, EdictSource } from '@shared/enums'
import type { SyncRunSummary } from '@shared/domain'
import type { EdictWrite, KnownEdict, RunProgress, SyncStoreState } from './sync'

export interface SyncRow {
  id: string
}

export interface SyncListing<Row extends SyncRow> {
  rows: Map<string, Row>
  /** A reason the list must not be used to remove records. */
  incomplete: string | null
}

export type PageResult<T> = { ok: true; value: T } | { ok: false; gone: boolean }

export interface SiteRun {
  signal: AbortSignal | undefined
  state: SyncStoreState
  scope: Bundesland[]
  kind: SyncRunSummary['kind']
  startedAt: string
  now: () => Date
  errors: string[]
  report: (phase: RunProgress['phase'], done: number, total: number) => void
  /** Applies the engine's cancellation, fatal-site and per-page error policy. */
  attempt: <T>(label: string, read: () => Promise<T>) => Promise<PageResult<T>>
}

export interface ChangedPage<Row, Page> {
  row: Row
  page: Page
}

/** The source-specific work inside a transactionally committed sync run. */
export interface SyncSite<Row extends SyncRow, Page> {
  source: EdictSource
  parserVersion: number
  incrementalList: boolean
  readonly requestCount: number
  list: (run: SiteRun) => Promise<SyncListing<Row>>
  needsPage: (run: SiteRun, row: Row, known: KnownEdict | undefined) => boolean
  readPage: (run: SiteRun, row: Row) => Promise<Page>
  contentHash: (page: Page) => string
  finish: (run: SiteRun, changed: readonly ChangedPage<Row, Page>[]) => Promise<EdictWrite[]>
  assessHealth: (sample: {
    rows: readonly Row[]
    pages: readonly ChangedPage<Row, Page>[]
  }) => string | null
}
