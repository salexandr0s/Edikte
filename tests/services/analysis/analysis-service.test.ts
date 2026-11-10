import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalysisProgressSchema, DEFAULT_SETTINGS, type Settings } from '@shared/domain'
import { AppError, type AppErrorCode } from '@shared/errors'
import type { EdictSource } from '@shared/enums'
import type { ProviderId, ProviderState } from '@shared/providers'
import type { AiProvider } from '../../../src/main/ai/provider'
import { listAnalyses, queueAnalyses } from '../../../src/main/db/analysis-store'
import { openDatabase, type AppDatabase } from '../../../src/main/db/client'
import { createDocumentStore } from '../../../src/main/db/document-store'
import { analyses, documents } from '../../../src/main/db/schema'
import type { EmitEvent } from '../../../src/main/ipc/events'
import {
  createAnalysisService,
  type ActiveProviderSource,
  type AnalysisServiceDeps,
} from '../../../src/main/services/analysis'
import { createDocumentService } from '../../../src/main/services/documents'
import { fakeProvider, houseAnswer, housePages } from '../../ai/analysis/helpers'
import { NOW, edictId, insertEdict, insertGutachten, storeReadDocument } from '../documents/seed'

const READY: Settings = {
  ...DEFAULT_SETTINGS,
  analysisConsentAt: NOW,
  selectedProvider: 'openai-api',
}

interface FakeSource extends ActiveProviderSource {
  /** What the providers service does after the user picked another provider. */
  select(selected: ProviderId | null): void
}

function activeSource(provider: AiProvider, state: ProviderState = 'ready'): FakeSource {
  const listeners = new Set<(selected: ProviderId | null) => void>()
  return {
    onSelectionChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    select: (selected) => {
      for (const listener of listeners) listener(selected)
    },
    active: () =>
      Promise.resolve({
        provider,
        model: 'gpt-test',
        status: {
          id: provider.id,
          state,
          version: null,
          binaryPath: null,
          binaryPathSource: null,
          accountLabel: 'tester@example.com',
          plan: null,
          detail: null,
          selected: true,
          model: 'gpt-test',
          checkedAt: NOW,
        },
      }),
  }
}

function unavailable(code: AppErrorCode): ActiveProviderSource {
  return {
    active: () => Promise.reject(new AppError(code, 'Not available')),
    onSelectionChange: () => () => undefined,
  }
}

/** Answers only once released, whatever its signal says; `calls` counts the requests. */
function slowProvider() {
  const base = fakeProvider('openai-api', [{ json: houseAnswer }])
  let release = (): void => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const calls: number[] = []
  const provider: AiProvider = {
    ...base,
    analyze: async (request, _signal, onProgress) => {
      calls.push(calls.length + 1)
      await released
      return base.analyze(request, new AbortController().signal, onProgress)
    },
  }
  return { provider, release, calls }
}

function job(edict: string, provider: ProviderId = 'openai-api') {
  return {
    edictId: edict,
    provider,
    model: 'gpt-test',
    accountLabel: null,
    promptVersion: 1,
    schemaVersion: 1,
    documentIds: [],
  }
}

interface Emitted {
  event: string
  payload: unknown
}

let db: AppDatabase
let documentsDir: string

beforeEach(async () => {
  db = openDatabase(':memory:')
  documentsDir = await mkdtemp(path.join(tmpdir(), 'edikte-analysis-'))
})

afterEach(async () => {
  db.$client.close()
  await rm(documentsDir, { recursive: true, force: true })
})

function setup(overrides: Partial<AnalysisServiceDeps> = {}) {
  const events: Emitted[] = []
  const emit: EmitEvent = (event, payload) => {
    events.push({ event, payload })
  }
  const store = createDocumentStore(db)
  const documents = createDocumentService({
    store,
    documentsDir,
    emit,
    extract: () => Promise.reject(new AppError('internal', 'Every test document is read already')),
    fetch: () => Promise.reject(new Error('No network in tests')),
    userAgent: 'Edikte tests',
    openPdf: () => Promise.resolve(),
    queryListings: () => ({ rows: [], totalInScope: 0 }),
    retentionDays: () => 30,
  })
  const service = createAnalysisService({
    db,
    store,
    documents,
    providers: activeSource(fakeProvider('openai-api', [{ json: houseAnswer }])),
    settings: () => READY,
    emit,
    renderPdf: () => Promise.resolve({ images: [], failedPages: [] }),
    documentsDir,
    now: () => new Date(NOW),
    ...overrides,
  })
  const statuses = () =>
    events
      .filter((emitted) => emitted.event === 'analysis:progress')
      .map((emitted) => AnalysisProgressSchema.parse(emitted.payload).status)
  return { service, events, statuses }
}

/** A listing whose Langgutachten is downloaded and read. */
async function readyListing(n: number, source: EdictSource = 'court_auction'): Promise<string> {
  const edict = source === 'court_auction' ? edictId(n) : `mv-${n}`
  insertEdict(db, edict, { source, propertyType: 'house', title: 'Einfamilienhaus' })
  await storeReadDocument(db, documentsDir, insertGutachten(db, edict), edict, housePages)
  return edict
}

describe('analysis service', () => {
  it('links evidence to the active report read after a queued report was replaced', async () => {
    const edict = await readyListing(201)
    const original = createDocumentStore(db).langgutachten([edict]).get(edict)
    expect(original).toBeDefined()
    queueAnalyses(db, [{ ...job(edict), documentIds: [original?.id ?? -1] }], NOW)
    db.update(documents)
      .set({ removedAt: NOW })
      .where(eq(documents.id, original?.id ?? -1))
      .run()
    const replacement = insertGutachten(db, edict, {
      url: `https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/0/${edict}/$file/replacement.pdf`,
      fileName: 'replacement.pdf',
    })
    await storeReadDocument(
      db,
      documentsDir,
      replacement,
      edict,
      housePages.map((page) => ({
        ...page,
        text: page.pageNumber === 1 ? `${page.text}\nReplacement report B` : page.text,
      })),
    )
    const provider = fakeProvider('openai-api', [{ json: houseAnswer }])
    const { service } = setup({ providers: activeSource(provider) })

    expect(await service.resumeQueued()).toBe(1)
    await service.idle()

    const content = provider.requests[0]?.content[0]
    expect(content?.type === 'text' ? content.text : '').toContain('Replacement report B')
    expect(listAnalyses(db, edict)[0]).toMatchObject({ status: 'done', documentId: replacement })
  })

  it('queues and checks prompt versions against each edict source', async () => {
    const auction = await readyListing(101)
    const sale = await readyListing(102, 'insolvency_sale')
    const staleAuction = await readyListing(103)
    const staleSale = await readyListing(104, 'insolvency_sale')
    const { service } = setup({
      providers: activeSource(fakeProvider('openai-api', [{ hang: true }])),
    })
    await service.start({ edictIds: [auction, sale] })
    expect(listAnalyses(db, auction)[0]?.promptVersion).toBe(2)
    expect(listAnalyses(db, sale)[0]?.promptVersion).toBe(1)
    await service.cancel({ all: true })
    await service.idle()

    const reports = createDocumentStore(db).langgutachten([auction, sale, staleAuction, staleSale])
    const jobs = queueAnalyses(
      db,
      [
        { ...job(auction), promptVersion: 2 },
        { ...job(sale), promptVersion: 1 },
        { ...job(staleAuction), promptVersion: 1 },
        { ...job(staleSale), promptVersion: 2 },
      ].map((queued) => ({ ...queued, documentIds: [reports.get(queued.edictId)?.id ?? -1] })),
      NOW,
    )
    for (const queued of jobs) {
      db.update(analyses)
        .set({ status: 'done', documentSha256: 'sha' })
        .where(eq(analyses.id, queued.analysisId))
        .run()
    }
    expect(
      await service.estimate({ edictIds: [auction, sale, staleAuction, staleSale] }),
    ).toMatchObject({ listings: 4, alreadyAnalyzed: 2 })
  })

  it('checks consent, then the selected provider, then that it is ready', async () => {
    const request = { edictIds: [await readyListing(1)] }
    const cases: [Partial<AnalysisServiceDeps>, AppErrorCode][] = [
      [
        {
          settings: () => ({ ...READY, analysisConsentAt: null, selectedProvider: null }),
          providers: unavailable('provider_not_selected'),
        },
        'consent_required',
      ],
      [
        {
          settings: () => ({ ...READY, selectedProvider: null }),
          providers: unavailable('provider_not_selected'),
        },
        'provider_not_selected',
      ],
      [{ providers: unavailable('provider_not_connected') }, 'provider_not_connected'],
      [
        { providers: activeSource(fakeProvider('openai-api', []), 'signed_out') },
        'provider_not_connected',
      ],
    ]
    for (const [overrides, code] of cases) {
      await expect(setup(overrides).service.start(request)).rejects.toMatchObject({ code })
    }
    expect(listAnalyses(db, request.edictIds[0] ?? '')).toEqual([])
  })

  it('skips listings without a Langgutachten or with a pending analysis, and runs the rest', async () => {
    const ready = await readyListing(2)
    const withoutDocument = edictId(3)
    insertEdict(db, withoutDocument)
    const pending = await readyListing(4)
    queueAnalyses(
      db,
      [
        {
          edictId: pending,
          provider: 'openai-api',
          model: 'gpt-test',
          accountLabel: null,
          promptVersion: 1,
          schemaVersion: 1,
          documentIds: [],
        },
      ],
      NOW,
    )
    const { service, events, statuses } = setup()

    expect(await service.start({ edictIds: [ready, withoutDocument, pending, ready] })).toEqual({
      queued: 1,
    })
    await service.idle()

    const [record] = listAnalyses(db, ready)
    expect(record).toMatchObject({ status: 'done', provider: 'openai-api', model: 'gpt-test' })
    expect(record?.result?.summary_de).toBe(houseAnswer.summary_de)
    expect(statuses()[0]).toBe('queued')
    expect(statuses().at(-1)).toBe('done')
    expect(events).toContainEqual({ event: 'listings:changed', payload: { edictIds: [ready] } })
  })

  it('runs the jobs a previous session left pending', async () => {
    const edict = await readyListing(5)
    const first = setup({ providers: activeSource(fakeProvider('openai-api', [{ hang: true }])) })
    expect(await first.service.start({ edictIds: [edict] })).toEqual({ queued: 1 })
    await first.service.shutdown()
    expect(listAnalyses(db, edict)[0]?.status).toMatch(/^(queued|running)$/)

    const second = setup()
    expect(await second.service.resumeQueued()).toBe(1)
    await second.service.idle()
    expect(listAnalyses(db, edict).map((record) => record.status)).toEqual(['done'])
  })

  it('cancels a queued job, then the running one, and rejects unknown IDs', async () => {
    const first = await readyListing(6)
    const second = await readyListing(7)
    const { service } = setup({
      providers: activeSource(fakeProvider('openai-api', [{ hang: true }])),
    })
    await service.start({ edictIds: [first, second] })

    await service.cancel({ analysisId: listAnalyses(db, second)[0]?.id ?? -1 })
    expect(listAnalyses(db, second)[0]?.status).toBe('cancelled')

    await service.cancel({ all: true })
    await service.idle()
    expect(listAnalyses(db, first)[0]?.status).toBe('cancelled')
    await expect(service.cancel({ analysisId: 9999 })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('leaves a running job to its run when Cancel is pressed twice', async () => {
    const edict = await readyListing(8)
    const slow = slowProvider()
    const { service, statuses } = setup({ providers: activeSource(slow.provider) })
    await service.start({ edictIds: [edict] })
    await vi.waitFor(() => expect(slow.calls).toHaveLength(1))
    const analysisId = listAnalyses(db, edict)[0]?.id ?? -1

    await service.cancel({ analysisId })
    await service.cancel({ analysisId })
    expect(listAnalyses(db, edict)[0]?.status).toBe('running')
    expect(statuses()).not.toContain('cancelled')
    expect(await service.start({ edictIds: [edict] })).toEqual({ queued: 0 })

    slow.release()
    await service.idle()
    const records = listAnalyses(db, edict)
    expect(records).toHaveLength(1)
    expect(records[0]?.status).not.toBe('running')
  })

  it('cancels every pending job at once, rows a previous session left included', async () => {
    const running = await readyListing(9)
    const waiting = [await readyListing(10), await readyListing(11)]
    const leftover = await readyListing(12)
    queueAnalyses(db, [job(leftover)], NOW)
    const { service, events } = setup({
      providers: activeSource(fakeProvider('openai-api', [{ hang: true }])),
    })
    await service.start({ edictIds: [running, ...waiting] })
    await vi.waitFor(() => expect(listAnalyses(db, running)[0]?.status).toBe('running'))
    const before = events.length

    await service.cancel({ all: true })
    await service.idle()

    const statusOf = (edict: string) => listAnalyses(db, edict)[0]?.status
    expect([running, ...waiting, leftover].map(statusOf)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
    ])
    const changes = events.slice(before).filter((emitted) => emitted.event === 'listings:changed')
    expect(changes).toHaveLength(3)
    expect(changes).toContainEqual({ event: 'listings:changed', payload: { edictIds: waiting } })
    expect(changes).toContainEqual({ event: 'listings:changed', payload: { edictIds: [leftover] } })
  })

  it('cancels the jobs of the previous provider once another one is selected', async () => {
    const first = await readyListing(13)
    const second = await readyListing(14)
    const leftover = await readyListing(15)
    queueAnalyses(db, [job(leftover, 'anthropic-api')], NOW)
    const source = activeSource(fakeProvider('openai-api', [{ hang: true }]))
    const { service } = setup({ providers: source })
    await service.start({ edictIds: [first, second] })
    await vi.waitFor(() => expect(listAnalyses(db, first)[0]?.status).toBe('running'))

    source.select('anthropic-api')
    await service.idle()

    const statusOf = (edict: string) => listAnalyses(db, edict)[0]?.status
    expect([first, second, leftover].map(statusOf)).toEqual(['cancelled', 'cancelled', 'queued'])
  })
})
