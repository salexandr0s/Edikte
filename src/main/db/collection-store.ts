import type { ListingRow, SavedFilter, Settings } from '@shared/domain'
import { AppError } from '@shared/errors'
import { applyListingQuery, withPriceBasis } from '@shared/listing-query'
import type {
  CollectionItem,
  CollectionPage,
  CollectionSection,
  ListingCollection,
} from '@shared/notifications'
import type { AppDatabase } from './client'
import { loadDiscoveryMetadata, type DiscoveryMetadata } from './discovery-store'
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

export interface SavedSearchSnapshot {
  rows: ListingRow[]
  filters: SavedFilter[]
  settings: Settings
  discoveries: Map<string, DiscoveryMetadata>
  matches: Map<number, CollectionItem[]>
  items(filterId: number | null, section: CollectionSection): CollectionItem[]
}

/** Reads each listing source once, then evaluates every saved search against it. */
export function loadSavedSearchSnapshot(
  db: AppDatabase,
  now: Date = new Date(),
): SavedSearchSnapshot {
  const settings = readSettings(db)
  const rows = loadListingSnapshot(db)
  const filters = listSavedFilters(db)
  const discoveries = loadDiscoveryMetadata(db)
  const matches = new Map<number, CollectionItem[]>()
  for (const filter of filters) {
    matches.set(
      filter.id,
      applyListingQuery(rows, filter.query).rows.map((listing) => ({
        listing,
        current: listing,
        filterIds: [filter.id],
        discoveryId: discoveries.get(listing.caseKey)?.id ?? null,
      })),
    )
  }

  const items = (filterId: number | null, section: CollectionSection): CollectionItem[] => {
    if (filterId !== null && !matches.has(filterId)) {
      throw new AppError('not_found', `Saved filter ${filterId} does not exist`)
    }
    const selected = filterId === null ? [...matches.values()] : [matches.get(filterId) ?? []]
    const combined = new Map<string, CollectionItem>()
    for (const group of selected) {
      for (const item of group) {
        const identity =
          item.discoveryId === null
            ? `case:${item.listing.caseKey}`
            : `discovery:${item.discoveryId}`
        const existing = combined.get(identity)
        if (existing !== undefined) {
          existing.filterIds.push(
            ...item.filterIds.filter((id) => !existing.filterIds.includes(id)),
          )
          continue
        }
        const listing =
          filterId === null ? withPriceBasis(item.listing, settings.priceBasis) : item.listing
        combined.set(identity, {
          ...item,
          listing,
          current: listing,
          filterIds: [...item.filterIds],
        })
      }
    }
    return [...combined.values()]
      .filter((item) => inSection(item, section, discoveries, now))
      .sort((a, b) => {
        if (section === 'upcoming') {
          return (
            (a.listing.auctionAt ?? '').localeCompare(b.listing.auctionAt ?? '') ||
            a.listing.id.localeCompare(b.listing.id)
          )
        }
        const atA = discoveries.get(a.listing.caseKey)?.committedAt ?? ''
        const atB = discoveries.get(b.listing.caseKey)?.committedAt ?? ''
        return atB.localeCompare(atA) || a.listing.id.localeCompare(b.listing.id)
      })
  }

  return { rows, filters, settings, discoveries, matches, items }
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

function inSection(
  item: CollectionItem,
  section: CollectionSection,
  discoveries: ReadonlyMap<string, DiscoveryMetadata>,
  now: Date,
): boolean {
  if (section === 'all') return true
  if (section === 'starred') return item.listing.starred
  if (section === 'new') {
    const discovery = discoveries.get(item.listing.caseKey)
    if (discovery?.kind !== 'live') return false
    const committed = Date.parse(discovery.committedAt)
    return committed >= now.getTime() - 7 * DAY_MS && committed <= now.getTime()
  }
  const row = item.listing
  if (
    row.source !== 'court_auction' ||
    row.auctionAt === null ||
    (row.status !== 'upcoming' && row.status !== 'postponed')
  )
    return false
  const localNow = viennaLocalDateTime(now)
  const [date, time] = localNow.split('T')
  const endDate = new Date(`${date}T00:00:00.000Z`)
  endDate.setUTCDate(endDate.getUTCDate() + 14)
  const localEnd = `${endDate.toISOString().slice(0, 10)}T${time}`
  return row.auctionAt >= localNow && row.auctionAt < localEnd
}

function viennaLocalDateTime(date: Date): string {
  const parts = Object.fromEntries(
    viennaParts.formatToParts(date).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
