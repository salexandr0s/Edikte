import type { z } from 'zod'
import {
  DEFAULT_SETTINGS,
  ListingQuerySchema,
  PRESET_WIEN_UNDER_5000,
  type AppInfo,
  type AreaValue,
  type KurzgutachtenFacts,
  type ListingDetail,
  type ListingRow,
  type RelatedEdict,
  type SavedFilter,
  type SyncRunSummary,
  type UserState,
} from '@shared/domain'
import { EDIKTE_ORIGIN, EX_DB_PATH, STATUS_BY_NOTICE } from '@shared/edikte-codes'
import { AppError, isAppError, type AppErrorShape } from '@shared/errors'
import {
  eventContract,
  ipcContract,
  type EdikteBridge,
  type IpcHandlerRequest,
  type IpcResponse,
  type IpcResult,
} from '@shared/ipc'
import type { EventChannel, InvokeChannel } from '@shared/ipc-channels'
import { applyListingQuery, withPriceBasis } from '@shared/listing-query'
import { PROVIDER_IDS } from '@shared/providers'
import { analysisArea, fakeAnalysisHistory, rowWithAnalyses } from './mock-analysis'
import { delay, type Emit, type MockHandlers, type MockState } from './mock-core'
import { createJobHandlers, fakeDocuments, fakeEstimates } from './mock-jobs'
import { createProviderHandlers, fakeProviderStatus } from './mock-providers'

/*
 * Stands in for the preload bridge when the renderer runs in a browser
 * (`npm run dev:renderer`). Every value here is made up. Requests and
 * responses go through the IPC contract as they do in the app, so a mock
 * that drifts from the contract fails loudly. Channels without a handler
 * answer `not_implemented`.
 *
 * Keep data inside functions: module-level side effects would stop the
 * production build from dropping this file.
 */

const LATENCY_MS = 120

export function createMockBridge(): EdikteBridge {
  const listeners = new Map<EventChannel, Set<(payload: unknown) => void>>()
  const emit: Emit = (event, payload) => {
    const parsed = eventContract[event].parse(payload)
    for (const listener of listeners.get(event) ?? []) listener(parsed)
  }
  const handlers = createHandlers(createState(), emit)

  return {
    invoke(channel, ...request: unknown[]) {
      return dispatch(handlers, channel, request[0])
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      const untyped = listener as (payload: unknown) => void
      set.add(untyped)
      listeners.set(event, set)
      return () => {
        set.delete(untyped)
      }
    },
  }
}

async function dispatch<C extends InvokeChannel>(
  handlers: MockHandlers,
  channel: C,
  raw: unknown,
): Promise<IpcResult<IpcResponse<C>>> {
  const schemas: { request: z.ZodType; response: z.ZodType } = ipcContract[channel]
  const handler = handlers[channel]
  await delay(LATENCY_MS)
  try {
    if (handler === undefined) {
      throw new AppError('not_implemented', `The mock bridge has no handler for ${channel}`)
    }
    const response = await handler(schemas.request.parse(raw) as IpcHandlerRequest<C>)
    return { ok: true, data: schemas.response.parse(response) as IpcResponse<C> }
  } catch (error) {
    return { ok: false, error: toErrorShape(error) }
  }
}

function toErrorShape(error: unknown): AppErrorShape {
  if (isAppError(error)) return error.toShape()
  return { code: 'internal', message: error instanceof Error ? error.message : String(error) }
}

function createHandlers(state: MockState, emit: Emit): MockHandlers {
  let syncTimer: ReturnType<typeof setInterval> | null = null
  let nextFilterId = Math.max(...state.filters.map((filter) => filter.id)) + 1

  const finishSync = (status: SyncRunSummary['status']) => {
    if (syncTimer !== null) clearInterval(syncTimer)
    syncTimer = null
    const current = state.sync.current
    const lastFinished =
      current === null
        ? state.sync.lastFinished
        : { ...current, status, finishedAt: new Date().toISOString() }
    state.sync = { state: 'idle', phase: null, done: 0, total: 0, current: null, lastFinished }
    emit('sync:progress', state.sync)
    if (status === 'ok') emit('listings:changed', { edictIds: null })
  }

  const rowsWithUserState = () =>
    state.rows.map((row) => {
      const user = state.userState.get(row.caseKey)
      return user ? { ...row, starred: user.starred, hidden: user.hidden } : row
    })

  return {
    'app:getInfo': () => fakeAppInfo(),
    'settings:get': () => state.settings,
    'settings:update': (patch) => {
      state.settings = { ...state.settings, ...patch }
      return state.settings
    },

    'sync:status': () => state.sync,
    'sync:start': ({ full }) => {
      if (state.sync.state !== 'idle') throw new AppError('busy', 'A sync is already running')
      const total = 12
      state.sync = {
        state: 'running',
        phase: 'list',
        done: 0,
        total,
        current: {
          id: (state.sync.lastFinished?.id ?? 0) + 1,
          kind: full ? 'full' : 'incremental',
          status: 'running',
          startedAt: new Date().toISOString(),
          finishedAt: null,
          listed: state.rows.length,
          fetched: 0,
          changed: 0,
          removed: 0,
          requests: 1,
          note: null,
        },
        lastFinished: state.sync.lastFinished,
      }
      syncTimer = setInterval(() => {
        const { current } = state.sync
        if (current === null) return
        const done = state.sync.done + 1
        if (done >= total) {
          state.sync = { ...state.sync, current: { ...current, fetched: total - 1, changed: 2 } }
          finishSync('ok')
          return
        }
        state.sync = {
          ...state.sync,
          phase: done < total / 2 ? 'details' : 'kurzgutachten',
          done,
          current: { ...current, fetched: done, requests: done + 1 },
        }
        emit('sync:progress', state.sync)
      }, 400)
      return state.sync
    },
    'sync:cancel': () => {
      if (state.sync.state === 'running') finishSync('cancelled')
      return state.sync
    },

    'listings:query': (query) => applyListingQuery(rowsWithUserState(), query),
    'listings:get': ({ id }) => {
      const index = state.rows.findIndex((candidate) => candidate.id === id)
      const row = rowsWithUserState()[index]
      if (!row) throw new AppError('not_found', `No mock listing ${id}`)
      return fakeDetail(state, row, index + 1)
    },

    'userState:update': ({ caseKey, ...changes }) => {
      const previous = state.userState.get(caseKey)
      const next: UserState = {
        caseKey,
        starred: changes.starred ?? previous?.starred ?? false,
        hidden: changes.hidden ?? previous?.hidden ?? false,
        notes: changes.notes ?? previous?.notes ?? '',
        updatedAt: new Date().toISOString(),
      }
      state.userState.set(caseKey, next)
      const edictIds = state.rows.filter((row) => row.caseKey === caseKey).map((row) => row.id)
      emit('listings:changed', { edictIds })
      return next
    },

    'filters:list': () => state.filters,
    'filters:save': ({ id, name, query }) => {
      const now = new Date().toISOString()
      const existing = state.filters.find((filter) => filter.id === id)
      if (existing?.presetKey) throw new AppError('forbidden', 'Presets cannot be changed')
      if (existing) {
        Object.assign(existing, { name, query, updatedAt: now })
        return existing
      }
      const created: SavedFilter = {
        id: nextFilterId++,
        name,
        query,
        presetKey: null,
        createdAt: now,
        updatedAt: now,
      }
      state.filters.push(created)
      return created
    },
    'filters:delete': ({ id }) => {
      const filter = state.filters.find((candidate) => candidate.id === id)
      if (!filter) throw new AppError('not_found', `No saved filter ${id}`)
      if (filter.presetKey) throw new AppError('forbidden', 'Presets cannot be deleted')
      state.filters = state.filters.filter((candidate) => candidate.id !== id)
    },

    ...createProviderHandlers(state, emit),
    ...createJobHandlers(state, emit, rowsWithUserState),

    'shell:openExternal': ({ url }) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
  }
}

function createState(): MockState {
  const now = new Date().toISOString()
  const listings = fakeListings()
  const documents = fakeDocuments(listings)
  const analyses = fakeAnalysisHistory(listings)
  return {
    settings: { ...DEFAULT_SETTINGS },
    rows: listings.map((row) => rowWithAnalyses(row, analyses, documents)),
    documents,
    estimates: fakeEstimates(listings, documents),
    analyses,
    userState: new Map(),
    filters: [
      {
        id: 1,
        name: 'Wien unter 5.000 €/m²',
        query: ListingQuerySchema.parse(PRESET_WIEN_UNDER_5000),
        presetKey: 'wien_under_5000',
        createdAt: now,
        updatedAt: now,
      },
    ],
    providers: PROVIDER_IDS.map((id) => fakeProviderStatus(id, now)),
    sync: {
      state: 'idle',
      phase: null,
      done: 0,
      total: 0,
      current: null,
      lastFinished: {
        id: 1,
        kind: 'full',
        status: 'ok',
        startedAt: '2026-11-04T07:00:00.000Z',
        finishedAt: '2026-11-04T07:04:10.000Z',
        listed: 9,
        fetched: 9,
        changed: 9,
        removed: 0,
        requests: 19,
        note: null,
      },
    },
  }
}

function fakeAppInfo(): AppInfo {
  const agent = navigator.userAgent
  return {
    name: 'Edikte',
    version: '0.1.0',
    platform: agent.includes('Windows') ? 'win32' : agent.includes('Mac') ? 'darwin' : 'linux',
    arch: 'unknown',
    isPackaged: false,
    electronVersion: 'none (browser preview)',
    systemLocale: navigator.language,
    dataDir: '/mock-data',
  }
}

/** An area stated on the edict page (Objektgröße). */
function fakeArea(sqm: number, kind: AreaValue['kind']): AreaValue {
  return { sqm, kind, source: 'listing', page: null, quote: null, documentId: null }
}

function fakeListing(
  n: number,
  fields: Pick<ListingRow, 'title' | 'propertyType'> & Partial<ListingRow>,
): ListingRow {
  const id = n.toString(16).padStart(32, '0')
  return withPriceBasis(
    {
      id,
      caseKey: `mock-case-${n}`,
      url: `${EDIKTE_ORIGIN}${EX_DB_PATH}/alldoc/${id}!OpenDocument`,
      status: 'upcoming',
      noticeType: 'versteigerung',
      categoryLabel: null,
      street: null,
      plz: null,
      city: 'Wien',
      bundesland: 'wien',
      bezirk: null,
      court: null,
      caseNumber: `${10 + n} E ${100 + n}/26x`,
      auctionAt: null,
      publishedAt: '2026-10-20',
      schaetzwertEur: null,
      geringstesGebotEur: null,
      area: null,
      plotSqm: null,
      priceBasis: 'schaetzwert',
      pricePerSqm: null,
      approximate: [],
      analysisStatus: null,
      riskLevel: null,
      hasLanggutachten: true,
      starred: false,
      hidden: false,
      removedAt: null,
      ...fields,
    },
    'schaetzwert',
  )
}

function fakeListings(): ListingRow[] {
  return [
    fakeListing(1, {
      title: 'Eigentumswohnung Top 12',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      street: 'Beispielgasse 12',
      plz: '1220',
      bezirk: 22,
      court: 'BG Donaustadt',
      auctionAt: '2026-12-03T10:00',
      schaetzwertEur: 245_000,
      geringstesGebotEur: 122_500,
      area: fakeArea(65.76, 'nutzflaeche'),
    }),
    fakeListing(2, {
      title: 'Eigentumswohnung Top 4',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      street: 'Musterstraße 3',
      plz: '1100',
      bezirk: 10,
      court: 'BG Favoriten',
      auctionAt: '2026-12-10T09:30',
      schaetzwertEur: 260_000,
      geringstesGebotEur: 130_000,
      area: {
        sqm: 48.2,
        kind: 'nutzflaeche',
        source: 'ai_verified',
        page: 8,
        quote: 'Nutzfläche gesamt 48,20 m²',
        documentId: 2,
      },
    }),
    fakeListing(3, {
      title: 'Einfamilienhaus',
      propertyType: 'house',
      categoryLabel: 'Einfamilienhaus',
      street: 'Probeweg 7',
      plz: '1210',
      bezirk: 21,
      court: 'BG Floridsdorf',
      auctionAt: '2027-01-14T10:00',
      schaetzwertEur: 520_000,
      geringstesGebotEur: 260_000,
      area: fakeArea(135.93, 'wohnflaeche'),
      plotSqm: 420,
      approximate: ['area_mismatch'],
    }),
    fakeListing(4, {
      title: 'Eigentumswohnung Top 2',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      street: 'Beispielgasse 30',
      plz: '1030',
      bezirk: 3,
      court: 'BG Innere Stadt Wien',
      auctionAt: '2026-12-17T11:00',
      schaetzwertEur: 310_000,
      geringstesGebotEur: 155_000,
    }),
    fakeListing(5, {
      title: 'Wohnung mit Loggia',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      status: 'postponed',
      noticeType: 'verschiebung',
      street: 'Musterweg 5',
      plz: '1150',
      bezirk: 15,
      court: 'BG Fünfhaus',
      auctionAt: '2027-02-04T10:00',
      schaetzwertEur: 198_000,
      geringstesGebotEur: 99_000,
      area: fakeArea(52, 'nutzflaeche'),
    }),
    fakeListing(6, {
      title: 'Einfamilienhaus mit Garten',
      propertyType: 'house',
      categoryLabel: 'Einfamilienhaus',
      street: 'Gartenstraße 9',
      plz: '2340',
      city: 'Mödling',
      bundesland: 'noe',
      court: 'BG Mödling',
      auctionAt: '2026-12-09T09:00',
      schaetzwertEur: 480_000,
      geringstesGebotEur: 240_000,
      area: fakeArea(110, 'wohnflaeche'),
      plotSqm: 650,
    }),
    fakeListing(7, {
      title: 'Geschäftslokal',
      propertyType: 'commercial',
      categoryLabel: 'Gewerbliche Liegenschaft',
      street: 'Beispielplatz 1',
      plz: '1020',
      bezirk: 2,
      court: 'BG Leopoldstadt',
      auctionAt: '2026-12-15T10:00',
      schaetzwertEur: 350_000,
      geringstesGebotEur: 175_000,
    }),
    fakeListing(8, {
      title: 'Eigentumswohnung Top 7',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      status: 'sold',
      noticeType: 'zuschlag_mit_ueberbot',
      street: 'Probegasse 21',
      plz: '1160',
      bezirk: 16,
      court: 'BG Hernals',
      auctionAt: '2026-10-08T10:00',
      schaetzwertEur: 290_000,
      geringstesGebotEur: 145_000,
      area: fakeArea(70, 'nutzflaeche'),
    }),
    fakeListing(9, {
      title: 'Baugrundstück',
      propertyType: 'land',
      categoryLabel: 'Baugrund',
      street: 'Am Beispielhang',
      plz: '1190',
      bezirk: 19,
      court: 'BG Döbling',
      auctionAt: '2027-01-21T10:00',
      schaetzwertEur: 900_000,
      geringstesGebotEur: 450_000,
      area: fakeArea(600, 'grundflaeche'),
      plotSqm: 600,
      hasLanggutachten: false,
    }),
  ]
}

function fakeDetail(state: MockState, row: ListingRow, n: number): ListingDetail {
  const rawLabels: Record<string, string> = {}
  if (row.court) rawLabels.Dienststelle = row.court
  if (row.caseNumber) rawLabels.Aktenzeichen = row.caseNumber
  if (row.schaetzwertEur !== null) rawLabels.Schätzwert = `EUR ${row.schaetzwertEur}`
  const documents = state.documents.filter((doc) => doc.edictId === row.id)
  const analyses = state.analyses.filter((record) => record.edictId === row.id)
  const estimates = state.estimates.filter((estimate) =>
    documents.some((doc) => doc.id === estimate.documentId),
  )
  const gutachten = documents.find((doc) => doc.kind === 'langgutachten')
  const latestDone = analyses.findLast((record) => record.status === 'done')
  const aiArea = latestDone === undefined ? null : analysisArea(latestDone, gutachten?.id ?? null)
  const areaCandidates: AreaValue[] = [
    ...(row.area?.source === 'listing' ? [row.area] : []),
    ...(aiArea === null ? [] : [aiArea]),
    ...estimates.map(({ sqm, kind, page, quote, documentId }) => ({
      sqm,
      kind,
      source: 'local_estimate' as const,
      page,
      quote,
      documentId,
    })),
  ]
  return {
    ...row,
    vadiumEur: row.schaetzwertEur === null ? null : Math.round(row.schaetzwertEur / 10),
    meistbotEur: row.status === 'sold' ? 301_000 : null,
    zubehoer: null,
    objektgroesseRaw: row.area?.source === 'listing' ? `${row.area.sqm} m²` : null,
    grundbuch: '01234 Beispielort',
    ez: String(100 + n),
    auctionPlace: row.court === null ? null : `${row.court}, Saal 1`,
    viewing: n === 1 ? '25.11.2026, 14:00 bis 15:00 Uhr' : null,
    remarks: null,
    rawLabels,
    kurzgutachten: fakeKurzgutachten(row),
    documents,
    estimates,
    areaCandidates,
    related: fakeRelated(row, n),
    analysis: analyses.at(-1) ?? null,
    notes: state.userState.get(row.caseKey)?.notes ?? '',
    firstSeenAt: '2026-10-21T08:00:00.000Z',
    lastSeenAt: new Date().toISOString(),
  }
}

/** Facts from the Kurzgutachten page; only homes with a Gutachten have one here. */
function fakeKurzgutachten(row: ListingRow): KurzgutachtenFacts | null {
  if (!row.hasLanggutachten || (row.propertyType !== 'apartment' && row.propertyType !== 'house')) {
    return null
  }
  const house = row.propertyType === 'house'
  return {
    anschluesse: house ? 'Wasser, Kanal, Strom, Gas' : 'Wasser, Kanal, Strom, Fernwärme',
    baubewilligung: house ? '1961, Benützungsbewilligung 1963' : '1973',
    widmung: house ? 'Bauland-Wohngebiet, Bauklasse I' : 'Bauland-Wohngebiet, Bauklasse III',
    bestandsverhaeltnisse: house ? 'Von der Eigentümerin selbst bewohnt' : 'Bestandfrei',
    stichtag: house ? '20.05.2026' : '15.06.2026',
    lasten: house ? null : 'Dienstbarkeit des Gehens über den Hof',
    erstelltVon:
      'DI Erika Mustermann, allgemein beeidete und gerichtlich zertifizierte Sachverständige',
    other: {},
  }
}

/** The earlier Versteigerung edict of a postponed or sold listing. */
function fakeRelated(row: ListingRow, n: number): RelatedEdict[] {
  if (row.noticeType === 'versteigerung') return []
  const id = (0xa000 + n).toString(16).padStart(32, '0')
  return [
    {
      id,
      noticeType: 'versteigerung',
      status: STATUS_BY_NOTICE.versteigerung,
      publishedAt: '2026-08-20',
      auctionAt: row.status === 'sold' ? row.auctionAt : '2026-11-26T10:00',
      url: `${EDIKTE_ORIGIN}${EX_DB_PATH}/alldoc/${id}!OpenDocument`,
    },
  ]
}
