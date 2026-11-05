import { createContext, useContext } from 'react'
import type { AppInfo, Settings, SettingsPatch } from '@shared/domain'

/** The screen in the main area. Listings stay mounted under the others. */
export type View =
  | { screen: 'firstRun' }
  | { screen: 'listings' }
  | { screen: 'detail'; id: string }
  | { screen: 'settings' }

export interface AppContextValue {
  info: AppInfo
  settings: Settings
  /** Saves a settings change and applies a new language. Throws a BridgeError. */
  updateSettings: (patch: SettingsPatch) => Promise<Settings>
  view: View
  navigate: (view: View) => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (value === null) throw new Error('useApp must be used inside the App component')
  return value
}
