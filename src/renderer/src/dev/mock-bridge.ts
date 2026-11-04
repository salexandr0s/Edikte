import type { z } from 'zod'
import {
  DEFAULT_SETTINGS,
  ListingQuerySchema,
  PRESET_WIEN_UNDER_5000,
  type AppInfo,
  type AreaValue,
  type ListingDetail,
  type ListingRow,
  type SavedFilter,
  type Settings,
  type SyncRunSummary,
  type SyncStatus,
  type UserState,
} from '@shared/domain'
import { EDIKTE_ORIGIN, EX_DB_PATH } from '@shared/edikte-codes'
import { AppError, isAppError, type AppErrorShape } from '@shared/errors'
import {
  eventContract,
  ipcContract,
  type EdikteBridge,
  type EventPayload,
  type IpcHandlerRequest,
  type IpcHandlerResponse,
  type IpcResponse,
  type IpcResult,
} from '@shared/ipc'
import type { EventChannel, InvokeChannel } from '@shared/ipc-channels'
import { applyListingQuery, withPriceBasis } from '@shared/listing-query'
import { PROVIDER_IDS, type ModelOption, type ProviderStatus } from '@shared/providers'

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

type MockHandlers = {
  [C in InvokeChannel]?: (
    request: IpcHandlerRequest<C>,
  ) => IpcHandlerResponse<C> | Promise<IpcHandlerResponse<C>>
}

type Emit = <E extends EventChannel>(event: E, payload: EventPayload<E>) => void

interface MockState {
  settings: Settings
  rows: ListingRow[]
  userState: Map<string, UserState>
  filters: SavedFilter[]
  providers: ProviderStatus[]
  sync: SyncStatus
}

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
      return fakeDetail(row, index, state.userState.get(row.caseKey))
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

    'providers:list': () => state.providers,
    'providers:detect': () => state.providers,
    'providers:models': ({ provider }) => fakeModels(provider),
    'providers:select': ({ provider }) => {
      state.providers = state.providers.map((status) => ({
        ...status,
        selected: status.id === provider,
      }))
      emit('providers:changed', state.providers)
      return state.providers
    },
    'providers:setModel': ({ provider, model }) => {
      const status = state.providers.find((candidate) => candidate.id === provider)
      if (!status) throw new AppError('not_found', `Unknown provider ${provider}`)
      status.model = model
      return status
    },

    'shell:openExternal': ({ url }) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
  }
}

function createState(): MockState {
  const now = new Date().toISOString()
  return {
    settings: { ...DEFAULT_SETTINGS },
    rows: fakeListings(),
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

function fakeProviderStatus(id: ProviderStatus['id'], checkedAt: string): ProviderStatus {
  const base: ProviderStatus = {
    id,
    state: 'signed_out',
    version: null,
    binaryPath: null,
    binaryPathSource: null,
    accountLabel: null,
    plan: null,
    detail: null,
    selected: false,
    model: null,
    checkedAt,
  }
  switch (id) {
    case 'claude-cli':
      return {
        ...base,
        state: 'ready',
        version: '2.1.226',
        binaryPath: '/Users/example/.local/bin/claude',
        binaryPathSource: 'known_location',
        accountLabel: 'you@example.com',
        plan: 'Max',
      }
    case 'codex-cli':
      return { ...base, state: 'not_installed' }
    default:
      return base
  }
}

function fakeModels(provider: ProviderStatus['id']): ModelOption[] {
  const option = (id: string, label: string, isDefault = false): ModelOption => ({
    id,
    label,
    supportsImages: true,
    isDefault,
  })
  switch (provider) {
    case 'claude-cli':
      return [
        option('default', 'Default', true),
        option('opus', 'Opus'),
        option('sonnet', 'Sonnet'),
        option('haiku', 'Haiku'),
      ]
    case 'codex-cli':
      return [option('default', 'Default', true)]
    default:
      return []
  }
}

function fakeArea(
  sqm: number,
  kind: AreaValue['kind'],
  source: AreaValue['source'] = 'listing',
): AreaValue {
  const fromDocument = source !== 'listing'
  return {
    sqm,
    kind,
    source,
    page: fromDocument ? 8 : null,
    quote: fromDocument ? `Nutzfläche gesamt ${String(sqm).replace('.', ',')} m²` : null,
    documentId: fromDocument ? 1 : null,
  }
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
      area: fakeArea(48.2, 'nutzflaeche', 'ai_verified'),
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
      area: fakeArea(80, 'nutzflaeche'),
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

function fakeDetail(row: ListingRow, index: number, user: UserState | undefined): ListingDetail {
  const rawLabels: Record<string, string> = {}
  if (row.court) rawLabels.Dienststelle = row.court
  if (row.caseNumber) rawLabels.Aktenzeichen = row.caseNumber
  if (row.schaetzwertEur !== null) rawLabels.Schätzwert = `EUR ${row.schaetzwertEur}`
  return {
    ...row,
    vadiumEur: row.schaetzwertEur === null ? null : Math.round(row.schaetzwertEur / 10),
    meistbotEur: row.status === 'sold' ? 301_000 : null,
    zubehoer: null,
    objektgroesseRaw: row.area?.source === 'listing' ? `${row.area.sqm} m²` : null,
    grundbuch: '01234 Beispielort',
    ez: String(100 + index),
    auctionPlace: row.court === null ? null : `${row.court}, Saal 1`,
    viewing: null,
    remarks: null,
    rawLabels,
    kurzgutachten: null,
    documents: row.hasLanggutachten
      ? [
          {
            id: index + 1,
            edictId: row.id,
            kind: 'langgutachten',
            title: 'Langgutachten (pdf) (7360 KB)',
            fileName: 'gutachten.pdf',
            url: `${EDIKTE_ORIGIN}${EX_DB_PATH}/0/${row.id}/$file/gutachten.pdf`,
            statedSizeKb: 7360,
            downloaded: false,
            downloadedAt: null,
            pageCount: null,
            scannedPages: [],
            extractError: null,
          },
        ]
      : [],
    estimates: [],
    areaCandidates: row.area ? [row.area] : [],
    related: [],
    analysis: null,
    notes: user?.notes ?? '',
    firstSeenAt: '2026-10-21T08:00:00.000Z',
    lastSeenAt: new Date().toISOString(),
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
