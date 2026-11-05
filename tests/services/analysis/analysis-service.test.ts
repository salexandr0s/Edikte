import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AnalysisProgressSchema, DEFAULT_SETTINGS, type Settings } from '@shared/domain'
import { AppError, type AppErrorCode } from '@shared/errors'
import type { ProviderState } from '@shared/providers'
import type { AiProvider } from '../../../src/main/ai/provider'
import { listAnalyses, queueAnalyses } from '../../../src/main/db/analysis-store'
import { openDatabase, type AppDatabase } from '../../../src/main/db/client'
import { createDocumentStore } from '../../../src/main/db/document-store'
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

function activeSource(provider: AiProvider, state: ProviderState = 'ready'): ActiveProviderSource {
  return {
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
  return { active: () => Promise.reject(new AppError(code, 'Not available')) }
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
async function readyListing(n: number): Promise<string> {
  const edict = edictId(n)
  insertEdict(db, edict, { propertyType: 'house', title: 'Einfamilienhaus' })
  await storeReadDocument(db, documentsDir, insertGutachten(db, edict), edict, housePages)
  return edict
}

describe('analysis service', () => {
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
})
