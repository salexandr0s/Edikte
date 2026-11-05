import { eq } from 'drizzle-orm'
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '@shared/domain'
import type { AppDatabase } from './client'
import { settings } from './schema'

const SETTINGS_ROW_ID = 1

export function readSettings(db: AppDatabase): Settings {
  const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ROW_ID)).get()
  return row ? parseStoredSettings(row.value) : DEFAULT_SETTINGS
}

/**
 * Reads stored settings field by field, so one invalid value (for example a
 * provider ID from a newer version) falls back to its default alone.
 */
export function parseStoredSettings(raw: unknown): Settings {
  const parsed = SettingsSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS
  const stored = raw as Record<string, unknown>
  const kept: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(SettingsSchema.shape)) {
    const value = field.safeParse(stored[key])
    if (value.success) kept[key] = value.data
  }
  return SettingsSchema.parse(kept)
}

export function writeSettings(db: AppDatabase, next: Settings): Settings {
  const value = SettingsSchema.parse(next)
  const updatedAt = new Date().toISOString()
  db.insert(settings)
    .values({ id: SETTINGS_ROW_ID, value, updatedAt })
    .onConflictDoUpdate({ target: settings.id, set: { value, updatedAt } })
    .run()
  return value
}

export function updateSettings(db: AppDatabase, patch: Partial<Settings>): Settings {
  return writeSettings(db, { ...readSettings(db), ...patch })
}
