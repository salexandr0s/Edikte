import type { GeocodeProgress, Settings } from '@shared/domain'
import { AppError, isAppError } from '@shared/errors'
import type { AppDatabase } from '../../db/client'
import { findLocationByKey, loadPendingLocations, saveLocation } from '../../db/location-store'
import type { Geocoder } from '../../geocode'
import type { EmitEvent } from '../../ipc/events'
import { log } from '../../log'

/** After a failed lookup, runs wait this long before asking the service again. */
export const GEOCODE_RETRY_MS = 5 * 60_000
/** listings:changed goes out after this many new positions, and when a run ends. */
const CHANGED_BATCH = 10

export type GeocodeSettings = Pick<Settings, 'syncBundeslaender'>

export interface GeocodeServiceDeps {
  db: AppDatabase
  geocoder: Geocoder
  /** Stored with each answer, such as `nominatim`. */
  provider: string
  emit: EmitEvent
  readSettings: () => GeocodeSettings
  /** Nothing is looked up, as with EDIKTE_OFFLINE; run() only reports the count. */
  offline?: boolean
  now?: () => number
}

export interface GeocodeService {
  /**
   * Starts looking up the addresses in scope that have no position yet,
   * unless a run is active, the app is offline or a run failed a moment ago.
   * Returns the state at once; the rest arrives as geocode:progress events.
   */
  run(): GeocodeProgress
  /** Resolves once no run is active. */
  idle(): Promise<void>
  /** Stops the active run and resolves once it has stopped writing. */
  dispose(): Promise<void>
}

export function createGeocodeService(deps: GeocodeServiceDeps): GeocodeService {
  const { db, geocoder, emit } = deps
  const now = deps.now ?? (() => Date.now())
  let current: GeocodeProgress = { pending: 0, running: false }
  let controller: AbortController | null = null
  let active: Promise<void> | null = null
  let disposed = false
  let retryNotBefore = 0

  const publish = (progress: GeocodeProgress): void => {
    current = progress
    if (!disposed) emit('geocode:progress', progress)
  }

  const execute = async (signal: AbortSignal): Promise<void> => {
    const pending = loadPendingLocations(db, deps.readSettings().syncBundeslaender)
    let left = pending.length
    publish({ pending: left, running: true })
    const changed: string[] = []
    const flush = (): void => {
      if (changed.length > 0 && !disposed) emit('listings:changed', { edictIds: changed.splice(0) })
    }
    try {
      for (const item of pending) {
        if (signal.aborted) break
        // Another edict with the same address already has the answer.
        let location = findLocationByKey(db, item.query.key)
        if (location === undefined) location = await geocoder.lookup(item.query, signal)
        saveLocation(db, {
          edictId: item.edictId,
          key: item.query.key,
          location,
          provider: deps.provider,
          geocodedAt: new Date(now()).toISOString(),
        })
        left -= 1
        if (location !== null) changed.push(item.edictId)
        if (changed.length >= CHANGED_BATCH) flush()
        publish({ pending: left, running: true })
      }
    } catch (error) {
      if (!signal.aborted) {
        retryNotBefore = now() + GEOCODE_RETRY_MS
        // Codes and counts only: addresses name the owners.
        log.warn('geocode', 'Address lookup stopped', {
          code: isAppError(error) ? error.code : 'unknown',
          pending: left,
        })
      }
    } finally {
      flush()
      publish({ pending: left, running: false })
    }
  }

  return {
    run: () => {
      if (disposed) throw new AppError('cancelled', 'The app is closing')
      if (controller !== null) return current
      if (deps.offline === true || now() < retryNotBefore) {
        const pending = loadPendingLocations(db, deps.readSettings().syncBundeslaender).length
        current = { pending, running: false }
        return current
      }
      const abort = new AbortController()
      controller = abort
      active = execute(abort.signal).finally(() => {
        controller = null
        active = null
      })
      return current
    },
    idle: async () => {
      if (active !== null) await active
    },
    dispose: async () => {
      disposed = true
      controller?.abort()
      if (active !== null) await active
    },
  }
}
