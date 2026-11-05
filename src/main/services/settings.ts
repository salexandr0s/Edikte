import type { Settings, SettingsPatch } from '@shared/domain'
import type { AppDatabase } from '../db/client'
import { readSettings, updateSettings } from '../db/settings-store'

export interface SettingsService {
  read(): Settings
  /** Saves a change from the renderer, then reports the old and new settings. */
  update(patch: SettingsPatch): Settings
}

/** Settings writes from the renderer, with a hook for what main does in response. */
export function createSettingsService(
  db: AppDatabase,
  onChange: (before: Settings, after: Settings) => void,
): SettingsService {
  return {
    read: () => readSettings(db),
    update: (patch) => {
      const before = readSettings(db)
      const after = updateSettings(db, patch)
      onChange(before, after)
      return after
    },
  }
}
