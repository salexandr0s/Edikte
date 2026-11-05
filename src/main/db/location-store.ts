import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { ListingLocation } from '@shared/domain'
import type { Bundesland } from '@shared/enums'
import { geocodeQuery, type GeocodeQuery } from '../geocode/address'
import type { AppDatabase } from './client'
import { edictLocations, edicts } from './schema'

// Stored answers of the geocoder, one row per edict. A row without
// coordinates records an address the geocoder did not know.

export interface PendingLocation {
  edictId: string
  query: GeocodeQuery
}

export interface LocationAnswer {
  edictId: string
  key: string
  /** Null when the geocoder did not know the address. */
  location: ListingLocation | null
  provider: string
  /** ISO UTC. */
  geocodedAt: string
}

/**
 * Edicts in scope whose address has no stored answer, or an answer for an
 * older address. Soonest auction first, so the map fills in where it matters.
 */
export function loadPendingLocations(
  db: AppDatabase,
  scope: readonly Bundesland[],
): PendingLocation[] {
  if (scope.length === 0) return []
  const rows = db
    .select({
      id: edicts.id,
      street: edicts.street,
      plz: edicts.plz,
      city: edicts.city,
      storedKey: edictLocations.query,
    })
    .from(edicts)
    .leftJoin(edictLocations, eq(edictLocations.edictId, edicts.id))
    .where(and(isNull(edicts.removedAt), inArray(edicts.bundesland, [...scope])))
    .orderBy(asc(edicts.auctionAt), asc(edicts.id))
    .all()
  const pending: PendingLocation[] = []
  for (const row of rows) {
    const query = geocodeQuery(row)
    if (query === null || row.storedKey === query.key) continue
    pending.push({ edictId: row.id, query })
  }
  return pending
}

/**
 * The stored answer for an address key, from any edict: the location, null
 * for an address the geocoder did not know, undefined when nothing is stored.
 */
export function findLocationByKey(
  db: AppDatabase,
  key: string,
): ListingLocation | null | undefined {
  const row = db
    .select({
      lat: edictLocations.lat,
      lng: edictLocations.lng,
      precision: edictLocations.precision,
    })
    .from(edictLocations)
    .where(eq(edictLocations.query, key))
    .orderBy(desc(edictLocations.geocodedAt))
    .limit(1)
    .get()
  if (row === undefined) return undefined
  if (row.lat === null || row.lng === null || row.precision === null) return null
  return { lat: row.lat, lng: row.lng, precision: row.precision }
}

export function saveLocation(db: AppDatabase, answer: LocationAnswer): void {
  const values = {
    edictId: answer.edictId,
    query: answer.key,
    lat: answer.location?.lat ?? null,
    lng: answer.location?.lng ?? null,
    precision: answer.location?.precision ?? null,
    provider: answer.provider,
    geocodedAt: answer.geocodedAt,
  }
  const { edictId: _edictId, ...update } = values
  db.insert(edictLocations)
    .values(values)
    .onConflictDoUpdate({ target: edictLocations.edictId, set: update })
    .run()
}
