import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../src/main/db/client'
import { documents } from '../../../src/main/db/schema'
import { createSyncStore } from '../../../src/main/db/sync-store'
import type { Bundesland, EdictSource } from '@shared/enums'
import type { JsonSource } from '../../../src/main/scraper/client'
import { createInsolvencySite } from '../../../src/main/scraper/insolvency/site'
import { INSOLVENCY_PARSER_VERSION } from '../../../src/main/scraper/insolvency/parser-version'
import {
  runSync,
  type KnownEdict,
  type SyncCommit,
  type SyncRunStart,
  type SyncStore,
  type SyncStoreState,
} from '../../../src/main/scraper/sync'

interface ApiRow {
  id: number
  publishedAt: string
  updatedAt?: string
}

function detail(id: number, bundesland = 'Wien') {
  const section = (
    title: string,
    values: Record<string, string>,
  ): { title: string; elements: unknown[] } => ({
    title,
    elements: [
      { type: 'LIST', items: Object.entries(values).map(([heading, text]) => ({ heading, text })) },
    ],
  })
  return {
    edikt: {
      id,
      sections: [
        section('Grunddaten', {
          Dienststelle: 'HG Musterstadt (099)',
          Aktenzeichen: '099 1 S 1/26 x',
          Bekanntmachungsdatum: '01.10.2026',
          'Art der Bekanntmachung': 'Liegenschaft',
          'Art der Transaktion': 'Veräußerung',
          'Name Schuldner:in': 'Private Person',
          Adresse: 'Debtor address',
        }),
        section('Adressdaten, Beschreibung und Schätzwert', {
          PLZ: '1030',
          Bundesland: bundesland,
          Kurzbeschreibung: 'Wohnung',
          'Kategorie(n)': 'Eigentumswohnung',
          'Wert des Objekts': '-',
          Objektgröße: '-',
          Beschreibung: 'Made-up property',
        }),
        section('Insolvenzverwalter:in', { Name: 'Dr. Muster' }),
      ],
    },
  }
}

function search(
  rows: ApiRow[],
  changes: Partial<{
    total: number
    page: number
    pageSize: number
    incompleteResult: boolean
  }> = {},
) {
  return {
    page: 1,
    pageSize: 100,
    total: rows.length,
    incompleteResult: false,
    edikte: rows,
    ...changes,
  }
}

class FakeApi implements JsonSource {
  requestCount = 0
  urls: string[] = []
  answer: (url: URL) => unknown = () => search([])
  getJson(url: string): Promise<unknown> {
    this.requestCount += 1
    this.urls.push(url)
    return Promise.resolve(this.answer(new URL(url)))
  }
}

class CaptureStore implements SyncStore {
  known = new Map<string, KnownEdict>()
  commits: SyncCommit[] = []
  loadedSource: EdictSource | null = null
  loadState(_scope: readonly Bundesland[], source: EdictSource): SyncStoreState {
    this.loadedSource = source
    return {
      known: this.known,
      lastOkRunStartedAt: '2026-11-09T08:00:00Z',
      lastOkFullRunStartedAt: '2026-11-09T08:00:00Z',
    }
  }
  startRun(_run: SyncRunStart): number {
    return this.commits.length + 1
  }
  commitRun(commit: SyncCommit): void {
    this.commits.push(commit)
  }
}

function known(id: number, changes: Partial<KnownEdict> = {}): KnownEdict {
  return {
    id: `mv-${id}`,
    noticeType: 'insolvenzverkauf',
    bundesland: 'wien',
    contentHash: 'stored',
    parserVersion: INSOLVENCY_PARSER_VERSION,
    auctionAt: null,
    fetchedAt: '2026-11-09T23:30:00Z',
    removedAt: null,
    ...changes,
  }
}

function setup(rows: ApiRow[]) {
  const source = new FakeApi()
  const store = new CaptureStore()
  source.answer = (url) => {
    const recordNumber = /\/edikte\/(\d+)$/.exec(url.pathname)?.[1]
    return recordNumber === undefined ? search(rows) : detail(Number(recordNumber))
  }
  const sync = () =>
    runSync({
      site: createInsolvencySite(source),
      store,
      scope: ['wien'],
      now: () => new Date('2026-11-10T08:00:00Z'),
    })
  return { source, store, sync }
}

function row(id: number, publishedAt = '2026-10-01'): ApiRow {
  return { id, publishedAt }
}

describe('insolvency sync strategy', () => {
  it.each(['file URL', 'file list'] as const)(
    'preserves a published report after %s layout drift but accepts a valid empty list',
    async (problem) => {
      const db = openDatabase(':memory:')
      const source = new FakeApi()
      let state: 'valid' | 'drift' | 'empty' = 'valid'
      const report = {
        fileName: 'Gutachten.pdf',
        fileUrl: 'service/edi/v1/edikte/990001/resources/sample',
        fileSize: 2048,
        mimeType: 'application/pdf',
      }
      source.answer = (url) => {
        if (url.searchParams.has('page'))
          return search([{ ...row(990001), updatedAt: '2026-11-10' }])
        const record = detail(990001)
        const items =
          state === 'empty'
            ? []
            : [
                state === 'drift' && problem === 'file URL'
                  ? { ...report, url: report.fileUrl, fileUrl: undefined }
                  : report,
              ]
        record.edikt.sections.push({
          title: 'Gutachten',
          elements: [
            state === 'drift' && problem === 'file list'
              ? { type: 'FILE_LIST', files: items }
              : { type: 'FILE_LIST', items },
          ],
        })
        return record
      }
      const sync = () =>
        runSync({
          site: createInsolvencySite(source),
          store: createSyncStore(db),
          scope: ['wien'],
          now: () => new Date('2026-11-10T08:00:00Z'),
        })
      const storedReport = () =>
        db
          .select({ removedAt: documents.removedAt })
          .from(documents)
          .where(eq(documents.edictId, 'mv-990001'))
          .get()
      try {
        expect((await sync()).status).toBe('ok')
        expect(storedReport()?.removedAt).toBeNull()
        state = 'drift'
        expect((await sync()).status).toBe('degraded')
        expect(storedReport()?.removedAt).toBeNull()
        state = 'empty'
        expect((await sync()).status).toBe('ok')
        expect(storedReport()?.removedAt).not.toBeNull()
      } finally {
        db.$client.close()
      }
    },
  )

  it('builds a sparse on-offer record without auction or debtor data', async () => {
    const { sync, store } = setup([row(990001)])
    expect(await sync()).toMatchObject({
      source: 'insolvency_sale',
      kind: 'full',
      status: 'ok',
      changed: 1,
    })
    expect(store.loadedSource).toBe('insolvency_sale')
    const written = store.commits[0]?.upserts[0]?.edict
    expect(written).toMatchObject({
      id: 'mv-990001',
      caseKey: 'insolvency:990001',
      status: 'on_offer',
      bundesland: 'wien',
      schaetzwertEur: null,
      objektgroesseSqm: null,
      auctionAt: null,
      geringstesGebotEur: null,
      insolvency: { administrator: { name: 'Dr. Muster' }, description: 'Made-up property' },
    })
    expect(JSON.stringify(written)).not.toMatch(/Private Person|Debtor address|Name Schuldner/)
  })

  it('reads every page and verifies each Land count before deduplicating', async () => {
    const { source, store, sync } = setup([])
    source.answer = (url) => {
      const id = /\/edikte\/(\d+)$/.exec(url.pathname)?.[1]
      if (id !== undefined) return detail(Number(id))
      const page = Number(url.searchParams.get('page'))
      return search([row(990000 + page)], { page, pageSize: 1, total: 2 })
    }
    expect(await sync()).toMatchObject({ status: 'ok', listed: 2, fetched: 2 })
    expect(source.urls.filter((url) => url.includes('?'))).toHaveLength(2)
    expect(store.commits[0]?.upserts.map((write) => write.edict.id)).toEqual([
      'mv-990001',
      'mv-990002',
    ])
  })

  it('retries a count mismatch once and trusts a complete retry', async () => {
    const { source, sync } = setup([])
    let lists = 0
    source.answer = (url) => {
      const id = /\/edikte\/(\d+)$/.exec(url.pathname)?.[1]
      if (id !== undefined) return detail(Number(id))
      lists += 1
      return search(lists === 1 ? [row(990001)] : [row(990001), row(990002)], { total: 2 })
    }
    expect(await sync()).toMatchObject({ status: 'ok', listed: 2, note: null })
    expect(lists).toBe(2)
  })

  it.each(['incomplete flag', 'count mismatch'] as const)(
    'does not remove records after a persistent %s',
    async (reason) => {
      const { source, store, sync } = setup([])
      store.known.set('mv-990009', known(990009))
      source.answer = (url) =>
        url.searchParams.has('page')
          ? search(
              [row(990001)],
              reason === 'incomplete flag' ? { incompleteResult: true } : { total: 2 },
            )
          : detail(990001)
      const summary = await sync()
      expect(summary).toMatchObject({ status: 'ok', removed: 0, changed: 1 })
      expect(summary.note).toContain('no edicts were marked as removed')
      expect(store.commits[0]?.removedIds).toEqual([])
      expect(source.urls.filter((url) => url.includes('?'))).toHaveLength(2)
    },
  )

  it('uses the Vienna fetch day and refreshes old parses, removed records and week-old pages', async () => {
    const rows = [
      row(990001, '2026-11-09'),
      row(990002, '2026-11-10'),
      row(990003),
      row(990004),
      row(990005),
      row(990006),
    ]
    const { source, store, sync } = setup(rows)
    for (const item of rows) store.known.set(`mv-${item.id}`, known(item.id))
    store.known.set('mv-990003', known(990003, { parserVersion: 0 }))
    store.known.set('mv-990004', known(990004, { removedAt: '2026-11-09T08:00:00Z' }))
    store.known.set('mv-990005', known(990005, { fetchedAt: '2026-11-03T08:00:00Z' }))
    store.known.set('mv-990006', known(990006, { contentHash: '' }))
    expect(await sync()).toMatchObject({ kind: 'full', status: 'ok', listed: 6, fetched: 5 })
    expect(source.urls.some((url) => url.endsWith('/990001'))).toBe(false)
    expect(store.commits[0]?.seenIds).toEqual(['mv-990001'])
  })

  it.each(['section', 'Bundesland'] as const)(
    'writes nothing when the %s health contract changes',
    async (problem) => {
      const { source, store, sync } = setup([row(990001)])
      source.answer = (url) => {
        if (url.searchParams.has('page')) return search([row(990001)])
        const record = detail(990001, problem === 'Bundesland' ? 'Steiermark' : 'Wien')
        if (problem === 'section') record.edikt.sections.pop()
        return record
      }
      expect(await sync()).toMatchObject({ status: 'degraded', changed: 0, removed: 0 })
      expect(store.commits[0]?.upserts).toEqual([])
    },
  )
})
