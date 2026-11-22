import type { SavedFilter, Settings } from '@shared/domain'
import { AppError } from '@shared/errors'
import { applyListingQuery, withPriceBasis } from '@shared/listing-query'
import type {
  CollectionItem,
  CollectionPage,
  CollectionSection,
  ListingCollection,
} from '@shared/notifications'
import type { AppDatabase } from './client'
import { loadDiscoveryMetadata } from './discovery-store'
import { loadListingSnapshot } from './listing-store'
import { createNotificationStore } from './notification-store'
import { readSettings } from './settings-store'
import { listSavedFilters } from './user-store'

const DAY_MS = 24 * 60 * 60 * 1000
const viennaParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type MatchSet = Map<number | string, CollectionItem>

interface SavedSearchSnapshot {
  totalInScope: number
  filters: SavedFilter[]
  settings: Settings
  counts(filterId: number | null): { matchCount: number; newCount: number }
  items(filterId: number | null, section: CollectionSection): CollectionItem[]
}

/** Each search is evaluated once per snapshot, and only if the caller uses it. */
export function loadSavedSearchSnapshot(
  db: AppDatabase,
  now: Date = new Date(),
): SavedSearchSnapshot {
  const settings = readSettings(db)
  const rows = loadListingSnapshot(db)
  const filters = listSavedFilters(db)
  const filtersById = new Map(filters.map((filter) => [filter.id, filter]))
  const discoveries = loadDiscoveryMetadata(db)
  const matches = new Map<number | null, MatchSet>()
  const recent = new Set<number>()
  const end = now.getTime()
  const start = end - 7 * DAY_MS
  for (const discovery of discoveries.values()) {
    if (discovery.kind !== 'live') continue
    const committed = Date.parse(discovery.committedAt)
    if (committed >= start && committed <= end) recent.add(discovery.id)
  }
  const auctionWindow = upcomingWindow(now)

  function matchesFor(filterId: number | null): MatchSet {
    const cached = matches.get(filterId)
    if (cached !== undefined) return cached
    const result: MatchSet = new Map()
    if (filterId === null) {
      for (const filter of filters) {
        for (const [identity, item] of matchesFor(filter.id)) {
          const existing = result.get(identity)
          if (existing !== undefined) existing.filterIds.push(filter.id)
          else {
            const listing = withPriceBasis(item.listing, settings.priceBasis)
            result.set(identity, { ...item, listing, current: listing, filterIds: [filter.id] })
          }
        }
      }
    } else {
      const filter = filtersById.get(filterId)
      if (filter === undefined)
        throw new AppError('not_found', `Saved filter ${filterId} does not exist`)
      for (const listing of applyListingQuery(rows, filter.query).rows) {
        const discoveryId = discoveries.get(listing.caseKey)?.id ?? null
        const identity = discoveryId ?? listing.caseKey
        if (!result.has(identity)) {
          result.set(identity, { listing, current: listing, filterIds: [filterId], discoveryId })
        }
      }
    }
    matches.set(filterId, result)
    return result
  }

  function counts(filterId: number | null) {
    const group = matchesFor(filterId)
    let newCount = 0
    for (const item of group.values()) {
      if (item.discoveryId !== null && recent.has(item.discoveryId)) newCount++
    }
    return { matchCount: group.size, newCount }
  }

  function items(filterId: number | null, section: CollectionSection): CollectionItem[] {
    const group = [...matchesFor(filterId).values()]
    if (section === 'upcoming') {
      return group
        .filter(
          ({ listing }) =>
            listing.source === 'court_auction' &&
            (listing.status === 'upcoming' || listing.status === 'postponed') &&
            listing.auctionAt !== null &&
            listing.auctionAt >= auctionWindow.start &&
            listing.auctionAt < auctionWindow.end,
        )
        .sort(
          (a, b) =>
            (a.listing.auctionAt ?? '').localeCompare(b.listing.auctionAt ?? '') ||
            a.listing.id.localeCompare(b.listing.id),
        )
    }
    const selected =
      section === 'new'
        ? group.filter(({ discoveryId }) => discoveryId !== null && recent.has(discoveryId))
        : section === 'starred'
          ? group.filter(({ listing }) => listing.starred)
          : group
    return selected.sort((a, b) => {
      const atA = discoveries.get(a.listing.caseKey)?.committedAt ?? ''
      const atB = discoveries.get(b.listing.caseKey)?.committedAt ?? ''
      return atB.localeCompare(atA) || a.listing.id.localeCompare(b.listing.id)
    })
  }

  return { totalInScope: rows.length, filters, settings, counts, items }
}

export function queryListingCollection(
  db: AppDatabase,
  collection: ListingCollection,
  now: Date = new Date(),
): CollectionPage {
  if (collection.kind === 'notification') {
    const detail = createNotificationStore(db).getNotification(collection.notificationId)
    return {
      items: detail.items,
      total: detail.notification.count,
      filterNames: [detail.notification.filterName],
    }
  }
  if (collection.kind === 'query') {
    const discoveries = loadDiscoveryMetadata(db)
    const rows = applyListingQuery(loadListingSnapshot(db), collection.query).rows
    return {
      items: rows.map((listing) => ({
        listing,
        current: listing,
        filterIds: [],
        discoveryId: discoveries.get(listing.caseKey)?.id ?? null,
      })),
      total: rows.length,
      filterNames: [],
    }
  }
  const snapshot = loadSavedSearchSnapshot(db, now)
  const items = snapshot.items(collection.filterId, collection.section)
  return {
    items,
    total: items.length,
    filterNames: snapshot.filters
      .filter((filter) => collection.filterId === null || filter.id === collection.filterId)
      .map((filter) => filter.name),
  }
}

export function searchInScope(filter: SavedFilter, settings: Settings): boolean {
  const sources = filter.query.sources
  const regions = filter.query.bundeslaender
  return (
    (sources.length === 0 || sources.some((source) => settings.syncSources.includes(source))) &&
    (regions.length === 0 || regions.some((region) => settings.syncBundeslaender.includes(region)))
  )
}

/** The next 14 Vienna calendar days, also when the UTC offset changes. */
function upcomingWindow(now: Date): { start: string; end: string } {
  const start = viennaLocalDateTime(now)
  const [date, time] = start.split('T')
  const endDate = new Date(`${date}T00:00:00.000Z`)
  endDate.setUTCDate(endDate.getUTCDate() + 14)
  return { start, end: `${endDate.toISOString().slice(0, 10)}T${time}` }
}

function viennaLocalDateTime(date: Date): string {
  const parts = Object.fromEntries(
    viennaParts.formatToParts(date).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
