import { and, eq, isNull, min, ne, sql } from 'drizzle-orm'
import { withPriceBasis } from '@shared/listing-query'
import type { SyncCommit } from '../scraper/sync'
import type { AppDatabase } from './client'
import { loadListingSnapshot } from './listing-store'
import { edicts, listingDiscoveries, syncRuns } from './schema'

type DiscoveryRow = typeof listingDiscoveries.$inferSelect

export interface DiscoveryMetadata {
  id: number
  committedAt: string
  firstSeenAt: string
  kind: 'baseline' | 'live'
}

export interface CanonicalDiscovery {
  id: number
  caseKey: string | null
  kind: 'baseline' | 'live'
}

/** Loads identities once for a batch of pending or historical notification items. */
export function createDiscoveryResolver(
  db: AppDatabase,
): (id: number) => CanonicalDiscovery | null {
  const rows = db
    .select({
      id: listingDiscoveries.id,
      caseKey: listingDiscoveries.caseKey,
      mergedIntoId: listingDiscoveries.mergedIntoId,
      kind: listingDiscoveries.kind,
    })
    .from(listingDiscoveries)
    .all()
  const byId = new Map(rows.map((row) => [row.id, row]))
  return (id) => {
    const row = resolveRow(byId, id)
    return row === undefined ? null : { id: row.id, caseKey: row.caseKey, kind: row.kind }
  }
}

/** Adds missing legacy cases before a successful commit can introduce new ones. */
export function seedDiscoveryBaseline(db: AppDatabase, now: Date = new Date()): void {
  const known = new Set(
    db
      .select({ caseKey: listingDiscoveries.caseKey })
      .from(listingDiscoveries)
      .all()
      .flatMap((row) => (row.caseKey === null ? [] : [row.caseKey])),
  )
  const earliest = new Map<
    string,
    { firstSeenAt: string; source: DiscoveryRow['source']; bundesland: DiscoveryRow['bundesland'] }
  >()
  for (const row of db
    .select({
      caseKey: edicts.caseKey,
      firstSeenAt: edicts.firstSeenAt,
      source: edicts.source,
      bundesland: edicts.bundesland,
    })
    .from(edicts)
    .all()) {
    const current = earliest.get(row.caseKey)
    if (current === undefined || row.firstSeenAt < current.firstSeenAt)
      earliest.set(row.caseKey, row)
  }
  for (const [caseKey, row] of earliest) {
    if (known.has(caseKey)) continue
    db.insert(listingDiscoveries)
      .values({
        caseKey,
        ...row,
        committedAt: now.toISOString(),
        kind: 'baseline',
        snapshot: null,
      })
      .onConflictDoNothing()
      .run()
  }
}

/** Called inside the sync transaction after every edict and document update. */
export function recordDiscoveries(db: AppDatabase, commit: SyncCommit): void {
  if (commit.summary.status !== 'ok' || commit.upserts.length === 0) return
  const known = new Set(
    db
      .select({ caseKey: listingDiscoveries.caseKey })
      .from(listingDiscoveries)
      .all()
      .flatMap((row) => (row.caseKey === null ? [] : [row.caseKey])),
  )
  const candidateKeys = new Set(
    commit.upserts
      .filter((write) => write.edict.source === commit.summary.source)
      .map((write) => write.edict.caseKey)
      .filter((caseKey) => !known.has(caseKey)),
  )
  if (candidateKeys.size === 0) return
  const coveredRegions = new Set(
    db
      .select({ scope: syncRuns.scope })
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.source, commit.summary.source),
          eq(syncRuns.kind, 'full'),
          eq(syncRuns.status, 'ok'),
          isNull(syncRuns.note),
          ne(syncRuns.id, commit.summary.id),
        ),
      )
      .all()
      .flatMap((run) => run.scope),
  )
  const firstSeen = new Map<string, string>()
  for (const row of db
    .select({ caseKey: edicts.caseKey, firstSeenAt: edicts.firstSeenAt })
    .from(edicts)
    .all()) {
    if (!candidateKeys.has(row.caseKey)) continue
    const earlier = firstSeen.get(row.caseKey)
    if (earlier === undefined || row.firstSeenAt < earlier)
      firstSeen.set(row.caseKey, row.firstSeenAt)
  }
  for (const listing of loadListingSnapshot(db, { allScopes: true, includeRemoved: true })) {
    if (!candidateKeys.has(listing.caseKey)) continue
    db.insert(listingDiscoveries)
      .values({
        caseKey: listing.caseKey,
        source: listing.source,
        bundesland: listing.bundesland,
        firstSeenAt: firstSeen.get(listing.caseKey) ?? commit.at,
        committedAt: commit.at,
        kind:
          listing.bundesland !== null && coveredRegions.has(listing.bundesland)
            ? 'live'
            : 'baseline',
        snapshot: withPriceBasis(listing, 'schaetzwert'),
      })
      .onConflictDoNothing()
      .run()
  }
}

/** Case corrections preserve discovery IDs, including IDs referenced by old digests. */
export function moveDiscoveryCase(db: AppDatabase, from: string, to: string): void {
  if (from === to) return
  const source = db
    .select()
    .from(listingDiscoveries)
    .where(eq(listingDiscoveries.caseKey, from))
    .get()
  if (source === undefined) return
  const target = db
    .select()
    .from(listingDiscoveries)
    .where(eq(listingDiscoveries.caseKey, to))
    .get()
  if (target === undefined) {
    db.update(listingDiscoveries)
      .set({ caseKey: to })
      .where(eq(listingDiscoveries.id, source.id))
      .run()
    db.insert(listingDiscoveries)
      .values({
        caseKey: from,
        mergedIntoId: source.id,
        source: source.source,
        bundesland: source.bundesland,
        firstSeenAt: source.firstSeenAt,
        committedAt: source.committedAt,
        kind: 'baseline',
        snapshot: null,
      })
      .onConflictDoNothing()
      .run()
    return
  }
  const winner = source.id < target.id ? source : target
  const loser = source.id < target.id ? target : source
  db.update(listingDiscoveries)
    .set({ caseKey: null, mergedIntoId: winner.id })
    .where(eq(listingDiscoveries.id, loser.id))
    .run()
  db.update(listingDiscoveries)
    .set({
      caseKey: to,
      firstSeenAt:
        source.firstSeenAt < target.firstSeenAt ? source.firstSeenAt : target.firstSeenAt,
      committedAt:
        source.committedAt < target.committedAt ? source.committedAt : target.committedAt,
      kind: source.kind === 'baseline' || target.kind === 'baseline' ? 'baseline' : 'live',
    })
    .where(eq(listingDiscoveries.id, winner.id))
    .run()
  db.update(listingDiscoveries)
    .set({ mergedIntoId: winner.id })
    .where(eq(listingDiscoveries.mergedIntoId, loser.id))
    .run()
  db.update(listingDiscoveries)
    .set({ caseKey: from })
    .where(eq(listingDiscoveries.id, loser.id))
    .run()
}

export function loadCanonicalCaseKeys(db: AppDatabase): Map<string, string> {
  const rows = db.select().from(listingDiscoveries).all()
  const byId = new Map(rows.map((row) => [row.id, row]))
  const result = new Map<string, string>()
  for (const row of rows) {
    const canonical = resolveRow(byId, row.id)
    if (canonical === undefined || canonical.caseKey === null) continue
    if (row.caseKey !== null) result.set(row.caseKey, canonical.caseKey)
    if (row.snapshot !== null) result.set(row.snapshot.caseKey, canonical.caseKey)
  }
  return result
}

export function resolveDiscoveryId(db: AppDatabase, id: number): number {
  const rows = db.select().from(listingDiscoveries).all()
  return resolveRow(new Map(rows.map((row) => [row.id, row])), id)?.id ?? id
}

export function loadDiscoveryMetadata(db: AppDatabase): Map<string, DiscoveryMetadata> {
  const rows = db
    .select({
      id: listingDiscoveries.id,
      caseKey: listingDiscoveries.caseKey,
      mergedIntoId: listingDiscoveries.mergedIntoId,
      committedAt: listingDiscoveries.committedAt,
      firstSeenAt: listingDiscoveries.firstSeenAt,
      kind: listingDiscoveries.kind,
      snapshotCaseKey: sql<
        string | null
      >`json_extract(${listingDiscoveries.snapshot}, '$.caseKey')`,
    })
    .from(listingDiscoveries)
    .all()
  const byId = new Map(rows.map((row) => [row.id, row]))
  const result = new Map<string, DiscoveryMetadata>()
  for (const row of rows) {
    const canonical = resolveRow(byId, row.id)
    if (canonical === undefined) continue
    const metadata: DiscoveryMetadata = {
      id: canonical.id,
      committedAt: canonical.committedAt,
      firstSeenAt: canonical.firstSeenAt,
      kind: canonical.kind,
    }
    if (row.caseKey !== null) result.set(row.caseKey, metadata)
    if (row.snapshotCaseKey !== null) result.set(row.snapshotCaseKey, metadata)
  }
  return result
}

export function discoveryTrackingStartedAt(db: AppDatabase): string | null {
  return (
    db
      .select({ earliest: min(listingDiscoveries.committedAt) })
      .from(listingDiscoveries)
      .where(isNull(listingDiscoveries.mergedIntoId))
      .get()?.earliest ?? null
  )
}

function resolveRow<T extends Pick<DiscoveryRow, 'id' | 'mergedIntoId'>>(
  rows: ReadonlyMap<number, T>,
  id: number,
): T | undefined {
  const visited = new Set<number>()
  let current = rows.get(id)
  while (current !== undefined && current.mergedIntoId !== null) {
    if (visited.has(current.id)) return undefined
    visited.add(current.id)
    current = rows.get(current.mergedIntoId)
  }
  return current
}
