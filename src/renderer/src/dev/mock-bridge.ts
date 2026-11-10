import type { z } from 'zod'
import {
  DEFAULT_SETTINGS,
  ListingQuerySchema,
  PRESET_WIEN_UNDER_5000,
  type AppInfo,
  type AreaValue,
  type InsolvencyFacts,
  type KurzgutachtenFacts,
  type ListingDetail,
  type ListingRow,
  type RelatedEdict,
  type SavedFilter,
  type Settings,
  type SyncRunSummary,
  type SyncStatus,
  type UserState,
} from '@shared/domain'
import { insolvencyEdictId } from '@shared/edict-id'
import {
  BUNDESLAND_SITE_NAMES,
  EDIKTE_ORIGIN,
  EX_DB_PATH,
  JUSTIZONLINE_ORIGIN,
  statusFor,
} from '@shared/edikte-codes'
import { EdictSourceSchema, type EdictSource } from '@shared/enums'
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
const SYNC_STEP_MS = 400

/** Steps of a simulated run. A run over the insolvency sales reads no Kurzgutachten pages. */
const RUN_STEPS: Readonly<Record<EdictSource, number>> = { court_auction: 12, insolvency_sale: 6 }

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
  /** Sources of the pass in progress whose run has not started, in sync order. */
  let waitingSources: EdictSource[] = []
  /** The newest finished run of every source, also of one the settings switch off. */
  const finishedRuns = new Map<EdictSource, SyncRunSummary>(
    state.sync.lastRuns.map((run) => [run.source, run]),
  )
  let nextRunId = Math.max(0, ...state.sync.lastRuns.map((run) => run.id)) + 1
  let geocodeRunning = false
  let nextFilterId = Math.max(...state.filters.map((filter) => filter.id)) + 1

  /**
   * The `lastRuns` of the status: the newest finished run of each enabled
   * source that has one, in sync order.
   */
  const lastRuns = (): SyncRunSummary[] =>
    enabledSources(state.settings).flatMap((source) => {
      const run = finishedRuns.get(source)
      return run === undefined ? [] : [run]
    })

  /**
   * Starts the run of the next waiting source, so the status stays `running`
   * from the first run of a pass to the last. With no source left, the pass
   * is over and the status goes idle.
   */
  const startNextRun = (kind: SyncRunSummary['kind']) => {
    const source = waitingSources.shift()
    if (source === undefined) {
      if (syncTimer !== null) clearInterval(syncTimer)
      syncTimer = null
      state.sync = {
        state: 'idle',
        phase: null,
        done: 0,
        total: 0,
        current: null,
        lastRuns: lastRuns(),
      }
      return
    }
    state.sync = {
      state: 'running',
      phase: runPhase(source, 0),
      done: 0,
      total: RUN_STEPS[source],
      current: {
        id: nextRunId++,
        source,
        kind,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        listed: state.rows.filter((row) => row.source === source).length,
        fetched: 0,
        changed: 0,
        removed: 0,
        requests: 1,
        note: null,
      },
      lastRuns: lastRuns(),
    }
  }

  /** Ends the run in progress with `status` and goes on with the pass. */
  const finishRun = (run: SyncRunSummary, status: SyncRunSummary['status']) => {
    finishedRuns.set(run.source, { ...run, status, finishedAt: new Date().toISOString() })
    startNextRun(run.kind)
    emit('sync:progress', state.sync)
    if (status === 'ok') emit('listings:changed', { edictIds: null })
  }

  /** One step of the run in progress. The last step ends the run as ok. */
  const stepRun = () => {
    const { current, total } = state.sync
    if (current === null) return
    const done = state.sync.done + 1
    if (done >= total) {
      finishRun({ ...current, fetched: total - 1, changed: 2 }, 'ok')
      return
    }
    state.sync = {
      ...state.sync,
      phase: runPhase(current.source, done),
      done,
      current: { ...current, fetched: done, requests: done + 1 },
    }
    emit('sync:progress', state.sync)
  }

  const rowsWithUserState = () =>
    state.rows.map((row) => {
      const user = state.userState.get(row.caseKey)
      return user ? { ...row, starred: user.starred, hidden: user.hidden } : row
    })

  /** The rows the list covers: those of the sources the settings enable. */
  const rowsInScope = () =>
    rowsWithUserState().filter((row) => state.settings.syncSources.includes(row.source))

  return {
    'app:getInfo': () => fakeAppInfo(),
    'settings:get': () => state.settings,
    'settings:update': (patch) => {
      state.settings = { ...state.settings, ...patch }
      if (patch.syncSources !== undefined) {
        // The enabled sources decide which finished runs the status holds and
        // which rows the list covers, so the list has to load again.
        state.sync = { ...state.sync, lastRuns: lastRuns() }
        emit('listings:changed', { edictIds: null })
      }
      return state.settings
    },

    'sync:status': () => state.sync,
    'sync:start': ({ full }) => {
      if (state.sync.state !== 'idle') throw new AppError('busy', 'A sync is already running')
      // One pass reads the enabled sources one after the other, each in a run of its own.
      waitingSources = enabledSources(state.settings)
      syncTimer = setInterval(stepRun, SYNC_STEP_MS)
      startNextRun(full ? 'full' : 'incremental')
      return state.sync
    },
    'sync:cancel': () => {
      const { current } = state.sync
      if (current !== null) {
        // Cancelling ends the pass: the sources still waiting do not run.
        waitingSources = []
        finishRun(current, 'cancelled')
      }
      return state.sync
    },

    'listings:query': (query) => applyListingQuery(rowsInScope(), query),
    'geocode:run': () => {
      // One address is still unknown; the pretend lookup places it a moment later.
      const unknown = state.rows.find((row) => row.street === 'Probegasse 21')
      if (unknown === undefined || unknown.location !== null || geocodeRunning) {
        return { pending: 0, running: geocodeRunning }
      }
      geocodeRunning = true
      const finish = () => {
        unknown.location = { lat: 48.2127, lng: 16.3119, precision: 'place' }
        geocodeRunning = false
        emit('geocode:progress', { pending: 0, running: false })
        emit('listings:changed', { edictIds: [unknown.id] })
      }
      void delay(1200).then(() => emit('geocode:progress', { pending: 1, running: true }))
      void delay(2400).then(finish)
      return { pending: 2, running: true }
    },
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
    ...createJobHandlers(state, emit, rowsInScope),

    'shell:openExternal': ({ url }) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
  }
}

/** The sources the settings enable, in the order the sync reads them. */
function enabledSources(settings: Settings): EdictSource[] {
  return EdictSourceSchema.options.filter((source) => settings.syncSources.includes(source))
}

/** The phase a simulated run shows once `done` of its steps are over. */
function runPhase(source: EdictSource, done: number): NonNullable<SyncStatus['phase']> {
  if (done === 0) return 'list'
  // Only auctions have Kurzgutachten pages. Reading them is the second half of their run.
  return source === 'court_auction' && done >= RUN_STEPS[source] / 2 ? 'kurzgutachten' : 'details'
}

function createState(): MockState {
  const now = new Date().toISOString()
  const settings = { ...DEFAULT_SETTINGS }
  const listings = fakeListings()
  const documents = fakeDocuments(listings)
  const analyses = fakeAnalysisHistory(listings)
  return {
    settings,
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
      lastRuns: fakeFirstRuns(settings),
    },
  }
}

/** The first sync of the enabled sources: one finished run each, and every run ok. */
function fakeFirstRuns(settings: Settings): SyncRunSummary[] {
  const runs: Readonly<Record<EdictSource, SyncRunSummary>> = {
    court_auction: {
      id: 1,
      source: 'court_auction',
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
    insolvency_sale: {
      id: 2,
      source: 'insolvency_sale',
      kind: 'full',
      status: 'ok',
      startedAt: '2026-11-04T07:04:10.000Z',
      finishedAt: '2026-11-04T07:04:14.000Z',
      listed: 2,
      fetched: 2,
      changed: 2,
      removed: 0,
      requests: 3,
      note: null,
    },
  }
  return enabledSources(settings).map((source) => runs[source])
}

function fakeAppInfo(): AppInfo {
  const agent = navigator.userAgent
  return {
    name: 'Edikte',
    version: '0.2.0',
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

/** The fields a fake listing has to state. Every other field has a default in `fakeListing`. */
type FakeListingFields = Pick<
  ListingRow,
  'id' | 'source' | 'caseKey' | 'url' | 'status' | 'noticeType' | 'title' | 'propertyType'
> &
  Partial<ListingRow>

function fakeListing(fields: FakeListingFields): ListingRow {
  return withPriceBasis(
    {
      categoryLabel: null,
      street: null,
      plz: null,
      city: 'Wien',
      bundesland: 'wien',
      bezirk: null,
      location: null,
      court: null,
      caseNumber: null,
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
      hasAnalysis: false,
      analysisStale: false,
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

/** A court auction. Its ID is `n`, written as a Domino document ID. */
function fakeAuction(
  n: number,
  fields: Pick<ListingRow, 'title' | 'propertyType'> & Partial<ListingRow>,
): ListingRow {
  const id = n.toString(16).padStart(32, '0')
  return fakeListing({
    id,
    source: 'court_auction',
    caseKey: `mock-case-${n}`,
    url: `${EDIKTE_ORIGIN}${EX_DB_PATH}/alldoc/${id}!OpenDocument`,
    status: 'upcoming',
    noticeType: 'versteigerung',
    caseNumber: `${10 + n} E ${100 + n}/26x`,
    ...fields,
  })
}

/**
 * A sale in insolvency proceedings by its JustizOnline record number. It is
 * on offer and has no auction.
 */
function fakeInsolvencySale(
  recordNumber: number,
  fields: Pick<ListingRow, 'title' | 'propertyType' | 'noticeType'> & Partial<ListingRow>,
): ListingRow {
  return fakeListing({
    id: insolvencyEdictId(recordNumber),
    source: 'insolvency_sale',
    caseKey: `insolvency:${recordNumber}`,
    url: `${JUSTIZONLINE_ORIGIN}/jop/web/ediktsdatei/suche/${recordNumber}`,
    status: 'on_offer',
    ...fields,
  })
}

function fakeListings(): ListingRow[] {
  return [
    fakeAuction(1, {
      title: 'Eigentumswohnung Top 12',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      street: 'Beispielgasse 12',
      plz: '1220',
      bezirk: 22,
      location: { lat: 48.2321, lng: 16.4452, precision: 'address' },
      court: 'BG Donaustadt',
      auctionAt: '2026-12-03T10:00',
      schaetzwertEur: 245_000,
      geringstesGebotEur: 122_500,
      area: fakeArea(65.76, 'nutzflaeche'),
    }),
    fakeAuction(2, {
      title: 'Eigentumswohnung Top 4',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      street: 'Musterstraße 3',
      plz: '1100',
      bezirk: 10,
      location: { lat: 48.1752, lng: 16.3781, precision: 'address' },
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
    fakeAuction(3, {
      title: 'Einfamilienhaus',
      propertyType: 'house',
      categoryLabel: 'Einfamilienhaus',
      street: 'Probeweg 7',
      plz: '1210',
      bezirk: 21,
      location: { lat: 48.2618, lng: 16.3994, precision: 'street' },
      court: 'BG Floridsdorf',
      auctionAt: '2027-01-14T10:00',
      schaetzwertEur: 520_000,
      geringstesGebotEur: 260_000,
      area: fakeArea(135.93, 'wohnflaeche'),
      plotSqm: 420,
      approximate: ['area_mismatch'],
    }),
    fakeAuction(4, {
      title: 'Eigentumswohnung Top 2',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      street: 'Beispielgasse 30',
      plz: '1030',
      bezirk: 3,
      location: { lat: 48.1991, lng: 16.3932, precision: 'address' },
      court: 'BG Innere Stadt Wien',
      auctionAt: '2026-12-17T11:00',
      schaetzwertEur: 310_000,
      geringstesGebotEur: 155_000,
    }),
    fakeAuction(5, {
      title: 'Wohnung mit Loggia',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      status: 'postponed',
      noticeType: 'verschiebung',
      street: 'Musterweg 5',
      plz: '1150',
      bezirk: 15,
      location: { lat: 48.1963, lng: 16.3204, precision: 'address' },
      court: 'BG Fünfhaus',
      auctionAt: '2027-02-04T10:00',
      schaetzwertEur: 198_000,
      geringstesGebotEur: 99_000,
      area: fakeArea(52, 'nutzflaeche'),
    }),
    fakeAuction(6, {
      title: 'Einfamilienhaus mit Garten',
      propertyType: 'house',
      categoryLabel: 'Einfamilienhaus',
      street: 'Gartenstraße 9',
      plz: '2340',
      city: 'Mödling',
      bundesland: 'noe',
      location: { lat: 48.0862, lng: 16.2887, precision: 'address' },
      court: 'BG Mödling',
      auctionAt: '2026-12-09T09:00',
      schaetzwertEur: 480_000,
      geringstesGebotEur: 240_000,
      area: fakeArea(110, 'wohnflaeche'),
      plotSqm: 650,
    }),
    fakeAuction(7, {
      title: 'Geschäftslokal',
      propertyType: 'commercial',
      categoryLabel: 'Gewerbliche Liegenschaft',
      street: 'Beispielplatz 1',
      plz: '1020',
      bezirk: 2,
      // The same point as Beispielgasse 30: one pin with two auctions.
      location: { lat: 48.1991, lng: 16.3932, precision: 'address' },
      court: 'BG Leopoldstadt',
      auctionAt: '2026-12-15T10:00',
      schaetzwertEur: 350_000,
      geringstesGebotEur: 175_000,
    }),
    fakeAuction(8, {
      title: 'Eigentumswohnung Top 7',
      propertyType: 'apartment',
      categoryLabel: 'Eigentumswohnung',
      status: 'sold',
      noticeType: 'zuschlag_mit_ueberbot',
      street: 'Probegasse 21',
      plz: '1160',
      bezirk: 16,
      // Found by the pretend lookup that geocode:run starts.
      location: null,
      court: 'BG Hernals',
      auctionAt: '2026-10-08T10:00',
      schaetzwertEur: 290_000,
      geringstesGebotEur: 145_000,
      area: fakeArea(70, 'nutzflaeche'),
    }),
    fakeAuction(9, {
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
    // The sales in insolvency proceedings come last: the fake documents and
    // analyses pick listings by their position in this list.
    fakeInsolvencySale(990001, {
      title: 'Eigentumswohnung Top 9',
      propertyType: 'apartment',
      noticeType: 'insolvenzverkauf',
      categoryLabel: 'Eigentumswohnung',
      street: 'Musterallee 8',
      plz: '1140',
      bezirk: 14,
      location: { lat: 48.1975, lng: 16.2913, precision: 'address' },
      court: 'HG Musterstadt',
      caseNumber: '099 4 S 12/26 x',
      publishedAt: '2026-10-19',
      schaetzwertEur: 189_000,
      area: fakeArea(58.4, 'nutzflaeche'),
    }),
    // A sparse notice: a lease that states no value and no area and has no files.
    fakeInsolvencySale(990002, {
      title: 'Geschäftslokal im Erdgeschoß',
      propertyType: 'commercial',
      noticeType: 'insolvenzverpachtung',
      categoryLabel: 'Gewerbliche Liegenschaft',
      street: 'Probezeile 3',
      plz: '1120',
      bezirk: 12,
      location: { lat: 48.1763, lng: 16.3274, precision: 'street' },
      court: 'HG Musterstadt',
      caseNumber: '099 6 S 31/26 k',
      publishedAt: '2026-10-12',
      hasLanggutachten: false,
    }),
  ]
}

function fakeDetail(state: MockState, row: ListingRow, n: number): ListingDetail {
  const documents = state.documents.filter((doc) => doc.edictId === row.id)
  const analyses = state.analyses.filter((record) => record.edictId === row.id)
  const gutachten = documents.find((doc) => doc.kind === 'langgutachten' && doc.removedAt === null)
  const estimates = state.estimates.filter((estimate) => estimate.documentId === gutachten?.id)
  const latestDone = analyses.findLast((record) => record.status === 'done' && !record.stale)
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
  // The fake sales in insolvency proceedings have no auction, and their
  // notices state no deposit, accessories or land register entry.
  const auction = row.source === 'court_auction'
  const objektgroesseRaw = row.area?.source === 'listing' ? `${row.area.sqm} m²` : null
  return {
    ...row,
    vadiumEur: auction && row.schaetzwertEur !== null ? Math.round(row.schaetzwertEur / 10) : null,
    meistbotEur: row.status === 'sold' ? 301_000 : null,
    zubehoer: auction ? 'kein Zubehör' : null,
    objektgroesseRaw,
    grundbuch: auction ? '01234 Beispielort' : null,
    ez: auction ? String(100 + n) : null,
    auctionPlace: auction && row.court !== null ? `${row.court}, Saal 1` : null,
    viewing: n === 1 ? '25.11.2026, 14:00 bis 15:00 Uhr' : null,
    remarks: null,
    rawLabels: fakeRawLabels(row, objektgroesseRaw),
    kurzgutachten: fakeKurzgutachten(row),
    insolvency: fakeInsolvency(row),
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

/**
 * The headings of the edict page with their values, as far as the row holds
 * them. A sale in insolvency proceedings has the headings of a JustizOnline
 * notice, without those that name the debtor.
 */
function fakeRawLabels(row: ListingRow, objektgroesse: string | null): Record<string, string> {
  const lease = row.noticeType === 'insolvenzverpachtung'
  const labels: Array<[label: string, value: string | null]> =
    row.source === 'insolvency_sale'
      ? [
          ['Dienststelle', row.court],
          ['Aktenzeichen', row.caseNumber],
          ['Bekanntmachungsdatum', row.publishedAt === null ? null : noticeDate(row.publishedAt)],
          ['Art der Transaktion', lease ? 'Verpachtung' : 'Veräußerung'],
          ['Straße', row.street],
          ['PLZ', row.plz],
          ['Ort', row.city],
          ['Bundesland', row.bundesland === null ? null : BUNDESLAND_SITE_NAMES[row.bundesland]],
          ['Kategorie(n)', row.categoryLabel],
          ['Wert des Objekts', row.schaetzwertEur === null ? null : `€ ${row.schaetzwertEur}`],
          ['Objektgröße', objektgroesse],
        ]
      : [
          ['Dienststelle', row.court],
          ['Aktenzeichen', row.caseNumber],
          ['Schätzwert', row.schaetzwertEur === null ? null : `EUR ${row.schaetzwertEur}`],
        ]
  return Object.fromEntries(labels.filter((entry): entry is [string, string] => entry[1] !== null))
}

/** A site date such as "2026-10-19" as a notice prints it: "19.10.2026". */
function noticeDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

/**
 * What the notice of a sale in insolvency proceedings says beyond the
 * property. The sale names an administrator with every way to reach her, a
 * deputy and a long text. The lease stands for a sparse notice: it has the
 * name of an administrator and nothing else. Neither says who the debtor is.
 */
function fakeInsolvency(row: ListingRow): InsolvencyFacts | null {
  if (row.source !== 'insolvency_sale') return null
  if (row.noticeType === 'insolvenzverpachtung') {
    return {
      administrator: {
        name: 'Mag. Anna Probe',
        address: null,
        phone: null,
        fax: null,
        email: null,
      },
      deputy: null,
      description: null,
      link: null,
    }
  }
  return {
    administrator: {
      name: 'Dr. Erika Beispiel',
      address: 'Beispielgasse 1, 1010 Wien',
      phone: '+43 1 000 00 00',
      fax: '+43 1 000 00 09',
      email: 'erika.beispiel@example.at',
    },
    deputy: {
      name: 'Mag. Paul Muster',
      address: null,
      phone: '+43 1 000 00 01',
      fax: null,
      email: 'paul.muster@example.at',
    },
    description:
      'Verkauft wird eine Wohnung im dritten Stock mit zwei Zimmern, Loggia und Kellerabteil. ' +
      'Die Wohnung ist bestandfrei und wird im vorhandenen Zustand übergeben. ' +
      'Schriftliche Anbote nimmt die Insolvenzverwalterin entgegen.',
    link: null,
  }
}

/**
 * Facts from the Kurzgutachten page of an auction. Only homes with a Gutachten
 * have one here. The notice of a sale in insolvency proceedings states such
 * facts itself, without a reference date and without an author. The lease
 * stands for a notice that states none.
 */
function fakeKurzgutachten(row: ListingRow): KurzgutachtenFacts | null {
  if (row.source === 'insolvency_sale') {
    if (row.noticeType !== 'insolvenzverkauf') return null
    return {
      anschluesse: 'Wasser, Kanal, Strom, Fernwärme',
      baubewilligung: '1968',
      widmung: 'Bauland-Wohngebiet, Bauklasse III',
      bestandsverhaeltnisse: 'Bestandfrei',
      stichtag: null,
      lasten: null,
      erstelltVon: null,
      other: { Benützungsbewilligung: '1970' },
    }
  }
  const home = row.propertyType === 'apartment' || row.propertyType === 'house'
  if (!row.hasLanggutachten || !home) return null
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

/** The earlier Versteigerung edict of a postponed or sold auction. */
function fakeRelated(row: ListingRow, n: number): RelatedEdict[] {
  if (row.source !== 'court_auction' || row.noticeType === 'versteigerung') return []
  const id = (0xa000 + n).toString(16).padStart(32, '0')
  return [
    {
      id,
      noticeType: 'versteigerung',
      status: statusFor('court_auction', 'versteigerung'),
      publishedAt: '2026-08-20',
      auctionAt: row.status === 'sold' ? row.auctionAt : '2026-11-26T10:00',
      url: `${EDIKTE_ORIGIN}${EX_DB_PATH}/alldoc/${id}!OpenDocument`,
    },
  ]
}
