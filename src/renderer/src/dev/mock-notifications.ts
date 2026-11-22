import type { ListingRow, SavedFilter } from '@shared/domain'
import { AppError } from '@shared/errors'
import { applyListingQuery, withPriceBasis } from '@shared/listing-query'
import type {
  AlertConfig,
  AlertRule,
  CollectionItem,
  CollectionPage,
  DashboardData,
  DeliveryStatus,
  ListingCollection,
  NotificationDetail,
  NotificationListRequest,
  SourceCoverage,
} from '@shared/notifications'
import type { Emit, MockHandlers, MockState } from './mock-core'

const DAY_MS = 24 * 60 * 60 * 1000

/** Browser-only sample state. Historic snapshots do not follow later listing edits. */
export function createMockNotificationHandlers(
  state: MockState,
  emit: Emit,
  currentRows: () => ListingRow[],
  now: () => Date = () => new Date(),
) {
  const startedAt = new Date(now().getTime() - 30 * DAY_MS).toISOString()
  const discoveries = new Map(
    state.rows.map((row, index) => [
      row.caseKey,
      {
        id: index + 1,
        at: new Date(now().getTime() - (index % 10) * DAY_MS).toISOString(),
      },
    ]),
  )
  const rules = new Map<number, AlertRule>()
  const filters = new Map<number, string>()
  const batches: NotificationDetail[] = []
  let pendingOpen: number | null = null
  let delivery: DeliveryStatus = {
    supported: false,
    lastAttemptAt: null,
    lastStatus: 'unknown',
    lastError: null,
  }

  const rowsInScope = () =>
    currentRows().filter(
      (row) =>
        state.settings.syncSources.includes(row.source) &&
        row.bundesland !== null &&
        state.settings.syncBundeslaender.includes(row.bundesland) &&
        (row.removedAt === null ||
          row.starred ||
          (state.userState.get(row.caseKey)?.notes ?? '') !== ''),
    )
  const filterById = (id: number) => {
    const filter = state.filters.find((candidate) => candidate.id === id)
    if (filter === undefined) throw new AppError('not_found', `No saved filter ${id}`)
    return filter
  }
  const coverage = (): SourceCoverage[] =>
    state.settings.syncSources.map((source) => {
      const run = state.sync.lastRuns.find((candidate) => candidate.source === source) ?? null
      return {
        source,
        lastSuccessAt: run?.status === 'ok' && run.note === null ? run.finishedAt : null,
        lastRun: run,
      }
    })
  const ruleFor = (id: number): AlertRule => {
    filterById(id)
    const existing = rules.get(id)
    if (existing !== undefined) return existing
    const rule: AlertRule = {
      filterId: id,
      enabled: false,
      cadence: 'weekly',
      time: '09:00',
      weekday: 1,
      desktopEnabled: true,
      revision: 1,
      nextDueAt: null,
    }
    rules.set(id, rule)
    return rule
  }
  const inScope = (filter: SavedFilter) => {
    const { query } = filter
    return (
      (query.sources.length === 0 ||
        query.sources.some((source) => state.settings.syncSources.includes(source))) &&
      (query.bundeslaender.length === 0 ||
        query.bundeslaender.some((region) => state.settings.syncBundeslaender.includes(region)))
    )
  }
  const itemFor = (row: ListingRow, filterIds: number[]): CollectionItem => ({
    listing: row,
    current: row,
    filterIds,
    discoveryId: discoveries.get(row.caseKey)?.id ?? null,
  })
  const selectedFilters = (id: number | null) => (id === null ? state.filters : [filterById(id)])
  const savedItems = (id: number | null): CollectionItem[] => {
    const selected = selectedFilters(id)
    const scoped = rowsInScope()
    const cases = new Map<string, CollectionItem>()
    for (const filter of selected) {
      for (const row of applyListingQuery(scoped, filter.query).rows) {
        const existing = cases.get(row.caseKey)
        if (existing === undefined)
          cases.set(
            row.caseKey,
            itemFor(selected.length === 1 ? row : withPriceBasis(row, 'schaetzwert'), [filter.id]),
          )
        else if (!existing.filterIds.includes(filter.id)) existing.filterIds.push(filter.id)
      }
    }
    return [...cases.values()].sort(
      (a, b) =>
        (discoveries.get(b.listing.caseKey)?.at ?? '').localeCompare(
          discoveries.get(a.listing.caseKey)?.at ?? '',
        ) || a.listing.id.localeCompare(b.listing.id),
    )
  }
  const sectionItems = (
    items: CollectionItem[],
    section: 'all' | 'new' | 'upcoming' | 'starred',
  ) => {
    if (section === 'new')
      return items.filter((item) => {
        const at = discoveries.get(item.listing.caseKey)?.at
        return at !== undefined && Date.parse(at) >= now().getTime() - 7 * DAY_MS
      })
    if (section === 'starred') return items.filter((item) => item.listing.starred)
    if (section !== 'upcoming') return items
    const today = viennaDay(now())
    const lastDay = addDays(today, 14)
    return items
      .filter(
        ({ listing }) =>
          listing.source === 'court_auction' &&
          (listing.status === 'upcoming' || listing.status === 'postponed') &&
          listing.auctionAt !== null &&
          listing.auctionAt.slice(0, 10) >= today &&
          listing.auctionAt.slice(0, 10) <= lastDay,
      )
      .sort((a, b) => (a.listing.auctionAt ?? '').localeCompare(b.listing.auctionAt ?? ''))
  }
  const batchById = (id: number) => {
    const detail = batches.find((candidate) => candidate.notification.id === id)
    if (detail === undefined) throw new AppError('not_found', `No notification ${id}`)
    return detail
  }
  const details = (id: number): NotificationDetail => {
    const detail = batchById(id)
    const rows = new Map(currentRows().map((row) => [row.caseKey, row]))
    return {
      notification: { ...detail.notification },
      items: detail.items.map((item) => ({
        ...item,
        listing: structuredClone(item.listing),
        current: rows.get(item.listing.caseKey) ?? null,
      })),
    }
  }
  const queryCollection = (collection: ListingCollection): CollectionPage => {
    if (collection.kind === 'notification') {
      const detail = details(collection.notificationId)
      return {
        items: detail.items,
        total: detail.notification.count,
        filterNames: [detail.notification.filterName],
      }
    }
    if (collection.kind === 'query') {
      const items = applyListingQuery(rowsInScope(), collection.query).rows.map((row) =>
        itemFor(row, []),
      )
      return { items, total: items.length, filterNames: [] }
    }
    const items = sectionItems(savedItems(collection.filterId), collection.section)
    return {
      items,
      total: items.length,
      filterNames: selectedFilters(collection.filterId).map((filter) => filter.name),
    }
  }
  const list = (request: NotificationListRequest) => {
    const limit = request.limit ?? 25
    const matches = batches
      .map(({ notification }) => notification)
      .filter(
        (notification) =>
          (request.filterId === undefined || notification.filterId === request.filterId) &&
          (!request.unreadOnly || notification.readAt === null) &&
          (request.beforeId === undefined || notification.id < request.beforeId),
      )
      .toSorted((a, b) => b.id - a.id)
    const items = matches.slice(0, limit).map((notification) => ({ ...notification }))
    return {
      items,
      nextCursor: matches.length > limit ? (items.at(-1)?.id ?? null) : null,
      unreadCount: batches.filter(({ notification }) => notification.readAt === null).length,
    }
  }
  const dashboard = (filterId: number | null): DashboardData => {
    const items = savedItems(filterId)
    const newListings = sectionItems(items, 'new')
    const upcomingListings = sectionItems(items, 'upcoming')
    const starredListings = sectionItems(items, 'starred')
    return {
      generatedAt: now().toISOString(),
      counts: {
        matching: items.length,
        new: newListings.length,
        upcoming: upcomingListings.length,
        starred: starredListings.length,
      },
      newListings: newListings.slice(0, 6),
      upcomingListings: upcomingListings.slice(0, 5),
      starredListings: starredListings.slice(0, 5),
      searches: state.filters.map((filter) => {
        const matched = savedItems(filter.id)
        return {
          filter,
          matchCount: matched.length,
          newCount: sectionItems(matched, 'new').length,
          alert: ruleFor(filter.id),
          inScope: inScope(filter),
        }
      }),
      notifications: list({ limit: 5, ...(filterId === null ? {} : { filterId }) }).items,
      coverage: coverage(),
      trackingStartedAt: startedAt,
      totalInScope: rowsInScope().length,
    }
  }
  const reconcileFilters = (scopeChanged = false) => {
    const present = new Set(state.filters.map((filter) => filter.id))
    for (const filter of state.filters) {
      const query = { ...filter.query, sort: undefined }
      const signature = JSON.stringify(query)
      const previous = filters.get(filter.id)
      if (scopeChanged || (previous !== undefined && previous !== signature)) {
        const rule = ruleFor(filter.id)
        rules.set(filter.id, { ...rule, revision: rule.revision + 1 })
      }
      filters.set(filter.id, signature)
    }
    for (const id of rules.keys()) if (!present.has(id)) rules.delete(id)
    for (const id of filters.keys()) if (!present.has(id)) filters.delete(id)
    for (const { notification } of batches) {
      if (notification.filterId !== null && !present.has(notification.filterId))
        notification.filterId = null
    }
    emit('filters:changed', {})
    emit('alerts:changed', {})
    emit('notifications:changed', {})
  }

  const first = state.filters[0]
  if (first !== undefined) {
    const sample = savedItems(first.id).slice(0, 3)
    if (sample.length > 0)
      batches.push({
        notification: {
          id: 1,
          filterId: first.id,
          filterName: first.name,
          presetKey: first.presetKey,
          query: structuredClone(first.query),
          createdAt: new Date(now().getTime() - DAY_MS).toISOString(),
          periodFrom: new Date(now().getTime() - 8 * DAY_MS).toISOString(),
          periodTo: new Date(now().getTime() - DAY_MS).toISOString(),
          count: sample.length,
          readAt: null,
          coverage: structuredClone(coverage()),
          desktopStatus: 'not_requested',
          desktopError: null,
        },
        items: structuredClone(sample),
      })
  }
  for (const filter of state.filters)
    filters.set(filter.id, JSON.stringify({ ...filter.query, sort: undefined }))

  const handlers = {
    'dashboard:get': ({ filterId }) => dashboard(filterId),
    'listings:queryCollection': queryCollection,
    'alerts:get': ({ filterId }) => ruleFor(filterId),
    'alerts:update': (config: AlertConfig) => {
      const previous = ruleFor(config.filterId)
      const next: AlertRule = {
        ...config,
        revision: previous.revision + Number(previous.enabled !== config.enabled),
        nextDueAt:
          config.enabled && config.cadence !== 'after_sync'
            ? nextDigest(config, now()).toISOString()
            : null,
      }
      rules.set(config.filterId, next)
      emit('alerts:changed', {})
      return next
    },
    'notifications:list': list,
    'notifications:get': ({ id }) => details(id),
    'notifications:markRead': ({ id }) => {
      batchById(id).notification.readAt ??= now().toISOString()
      emit('notifications:changed', {})
    },
    'notifications:markAllRead': () => {
      for (const detail of batches) detail.notification.readAt ??= now().toISOString()
      emit('notifications:changed', {})
    },
    'notifications:deliveryStatus': () => delivery,
    'notifications:testDesktop': () => {
      delivery = {
        supported: false,
        lastAttemptAt: now().toISOString(),
        lastStatus: 'unsupported',
        lastError: null,
      }
      return delivery
    },
    'notifications:pendingOpen': () => pendingOpen,
    'notifications:ackOpen': ({ id }) => {
      if (pendingOpen === id) pendingOpen = null
    },
  } satisfies MockHandlers
  return { handlers, reconcileFilters }
}

function viennaDay(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** The preview uses Vienna's first occurrence and advances across a spring gap. */
function nextDigest(config: AlertConfig, after: Date): Date {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Vienna',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const local = (date: Date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    )
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
  }
  for (let days = 0; days <= 7; days++) {
    const day = addDays(viennaDay(after), days)
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7
    if (config.cadence === 'weekly' && weekday !== config.weekday) continue
    const desired = Date.parse(`${day}T${config.time}:00Z`)
    for (let shift = 0; shift <= 120; shift++) {
      const wallTime = new Date(desired + shift * 60_000).toISOString().slice(0, 16)
      const candidates = [120, 60]
        .map((offset) => new Date(desired + (shift - offset) * 60_000))
        .filter((candidate) => local(candidate) === wallTime)
      const first = candidates[0]
      if (first === undefined) continue
      if (first.getTime() > after.getTime()) return first
      break
    }
  }
  throw new AppError('internal', 'No upcoming digest time')
}
