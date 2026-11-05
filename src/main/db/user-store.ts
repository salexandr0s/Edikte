import { asc, eq } from 'drizzle-orm'
import {
  ListingQuerySchema,
  PRESET_WIEN_UNDER_5000,
  type ListingQueryInput,
  type SavedFilter,
  type UserState,
} from '@shared/domain'
import { AppError } from '@shared/errors'
import type { AppDatabase } from './client'
import { savedFilters, userState } from './schema'

// ── Star, hide, notes ──────────────────────────────────────────────────────

export interface UserStatePatch {
  caseKey: string
  starred?: boolean | undefined
  hidden?: boolean | undefined
  notes?: string | undefined
}

export function updateUserState(db: AppDatabase, patch: UserStatePatch): UserState {
  const current = db.select().from(userState).where(eq(userState.caseKey, patch.caseKey)).get()
  const next: UserState = {
    caseKey: patch.caseKey,
    starred: patch.starred ?? current?.starred ?? false,
    hidden: patch.hidden ?? current?.hidden ?? false,
    notes: patch.notes ?? current?.notes ?? '',
    updatedAt: new Date().toISOString(),
  }
  db.insert(userState)
    .values(next)
    .onConflictDoUpdate({ target: userState.caseKey, set: next })
    .run()
  return next
}

// ── Saved filters ──────────────────────────────────────────────────────────

const PRESETS: ReadonlyArray<{
  presetKey: NonNullable<SavedFilter['presetKey']>
  name: string
  query: ListingQueryInput
}> = [
  { presetKey: 'wien_under_5000', name: 'Wien unter 5.000 €/m²', query: PRESET_WIEN_UNDER_5000 },
]

/** Inserts shipped presets that are missing. Existing presets are left as they are. */
export function ensurePresetFilters(db: AppDatabase): void {
  const now = new Date().toISOString()
  for (const preset of PRESETS) {
    db.insert(savedFilters)
      .values({ ...preset, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: savedFilters.presetKey })
      .run()
  }
}

export function listSavedFilters(db: AppDatabase): SavedFilter[] {
  return db
    .select()
    .from(savedFilters)
    .orderBy(asc(savedFilters.id))
    .all()
    .map((row) => {
      const query = ListingQuerySchema.safeParse(row.query)
      return {
        id: row.id,
        name: row.name,
        // A query saved by another version that no longer parses resets to defaults.
        query: query.success ? query.data : ListingQuerySchema.parse({}),
        presetKey: PRESETS.find((preset) => preset.presetKey === row.presetKey)?.presetKey ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    })
}

export function saveFilter(
  db: AppDatabase,
  input: { id?: number | undefined; name: string; query: ListingQueryInput },
): SavedFilter {
  const now = new Date().toISOString()
  if (input.id === undefined) {
    const row = db
      .insert(savedFilters)
      .values({ name: input.name, query: input.query, createdAt: now, updatedAt: now })
      .returning({ id: savedFilters.id })
      .get()
    return findFilter(db, row.id)
  }
  const existing = findFilter(db, input.id)
  if (existing.presetKey !== null) {
    throw new AppError('forbidden', 'Presets cannot be changed; save a copy instead')
  }
  db.update(savedFilters)
    .set({ name: input.name, query: input.query, updatedAt: now })
    .where(eq(savedFilters.id, input.id))
    .run()
  return findFilter(db, input.id)
}

export function deleteFilter(db: AppDatabase, id: number): void {
  if (findFilter(db, id).presetKey !== null) {
    throw new AppError('forbidden', 'Presets cannot be deleted')
  }
  db.delete(savedFilters).where(eq(savedFilters.id, id)).run()
}

function findFilter(db: AppDatabase, id: number): SavedFilter {
  const filter = listSavedFilters(db).find((candidate) => candidate.id === id)
  if (filter === undefined) throw new AppError('not_found', `Saved filter ${id} does not exist`)
  return filter
}
