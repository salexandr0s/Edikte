import type { Settings, SyncRunSummary, SyncStatus } from '@shared/domain'
import type { Bundesland, EdictSource } from '@shared/enums'
import { AppError } from '@shared/errors'
import type { AppDatabase } from '../../db/client'
import {
  closeOpenRuns,
  createSyncStore,
  lastFinishedRun,
  loadSyncSchedule,
} from '../../db/sync-store'
import type { EmitEvent } from '../../ipc/events'
import { log } from '../../log'
import type { PageSource } from '../../scraper/client'
import { runSync } from '../../scraper/sync'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/** The section of the Ediktsdatei the service syncs. */
const EDICT_SOURCE: EdictSource = 'court_auction'

/**
 * An automatic sync starts when the last run over the scope that got an
 * answer from the site finished this long ago. Whether a run lists everything
 * (once a day) is decided by `runSync`.
 */
export const AUTO_SYNC_INTERVAL_MS = 6 * HOUR_MS
/** Auto sync tries again this long after a run that was cancelled or never reached the site. */
export const AUTO_SYNC_RETRY_MS = 20 * MINUTE_MS

const INTERRUPTED_NOTE = 'The app closed during this sync'
const STORAGE_FAILED_NOTE = 'The sync result could not be saved'

/** The settings the sync service reads. */
export type SyncSettings = Pick<Settings, 'syncBundeslaender' | 'autoSync' | 'firstRunCompletedAt'>

export interface SyncServiceDeps {
  db: AppDatabase
  /** The app's shared client, so every request shares one rate limit. */
  source: PageSource
  emit: EmitEvent
  readSettings: () => SyncSettings
  /** No automatic runs, as with EDIKTE_OFFLINE. Runs the user starts still work. */
  offline?: boolean
  /** Subscribes to the computer waking from sleep; returns a function that unsubscribes. */
  onResume?: (listener: () => void) => () => void
  now?: () => Date
}

export interface SyncService {
  status(): SyncStatus
  /** Starts a run over the scope in the settings. Throws `busy` while one is active. */
  start(options: { full: boolean }): SyncStatus
  /** Asks the active run to stop; it ends as cancelled and writes nothing. */
  cancel(): void
  /**
   * Starts an incremental run when auto sync may run and one is due, and
   * otherwise sets a timer for the next check. Returns whether a run started.
   * Auto sync waits for the first-run screen and never runs offline.
   */
  startIfDue(): boolean
  /** Reloads the list when the scope changed and checks whether a run is due. */
  onSettingsChanged(before: SyncSettings, after: SyncSettings): void
  /** Stops the timer, cancels an active run and resolves once it has stopped writing. */
  dispose(): Promise<void>
}

export function createSyncService(deps: SyncServiceDeps): SyncService {
  const { db, source, emit } = deps
  const now = deps.now ?? (() => new Date())
  const store = createSyncStore(db)
  // No run can be active yet: one still marked running was cut off by a quit.
  closeOpenRuns(db, { status: 'cancelled', note: INTERRUPTED_NOTE, finishedAt: null })

  let current: SyncStatus = idle(readLastRuns(db))
  let controller: AbortController | null = null
  let active: Promise<void> | null = null
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Earliest next automatic run (ms); set when a result could not be stored at all. */
  let retryNotBefore = 0

  const publish = (status: SyncStatus): void => {
    current = status
    if (!disposed) emit('sync:progress', status)
  }

  const execute = async (scope: Bundesland[], full: boolean, signal: AbortSignal) => {
    // A status during the run lists the runs that had finished before it started.
    const earlierRuns = current.lastRuns
    try {
      const summary = await runSync({
        source,
        store,
        scope,
        signal,
        forceFull: full,
        now,
        onProgress: (progress) => {
          publish({
            ...progress,
            state: signal.aborted ? 'cancelling' : 'running',
            lastRuns: earlierRuns,
          })
        },
      })
      // The engine reports progress only. The idle status goes out here, ahead of
      // the event that reloads the list.
      publish(idle(readLastRuns(db)))
      if (summary.status === 'ok' && !disposed) emit('listings:changed', { edictIds: null })
    } catch (error) {
      // runSync handles site errors itself; what reaches here is a storage error.
      log.error('sync', 'The sync could not be stored', error)
      retryNotBefore = now().getTime() + AUTO_SYNC_RETRY_MS
      let lastRuns = current.lastRuns
      try {
        closeOpenRuns(db, {
          status: 'failed',
          note: STORAGE_FAILED_NOTE,
          finishedAt: now().toISOString(),
          failureCode: 'storage_unavailable',
        })
        lastRuns = readLastRuns(db)
      } catch (cleanupError) {
        log.error('sync', 'The failed sync could not be closed', cleanupError)
      }
      publish(idle(lastRuns))
    }
  }

  const start = ({ full }: { full: boolean }): SyncStatus => {
    if (disposed) throw new AppError('cancelled', 'The app is closing')
    if (controller !== null) throw new AppError('busy', 'A sync is already running')
    const scope = [...deps.readSettings().syncBundeslaender]
    const abort = new AbortController()
    controller = abort
    publish({ ...idle(current.lastRuns), state: 'running' })
    active = execute(scope, full, abort.signal).finally(() => {
      controller = null
      active = null
      // The next due time moved, and the settings may have changed during the run.
      if (!disposed) checkSchedule()
    })
    return current
  }

  /** When the next automatic run is due (ms), or null while auto sync must not run. */
  const nextDueAt = (): number | null => {
    if (deps.offline === true) return null
    const settings = deps.readSettings()
    if (!settings.autoSync || settings.firstRunCompletedAt === null) return null
    const { settledAt, unsettledAt } = loadSyncSchedule(
      db,
      settings.syncBundeslaender,
      EDICT_SOURCE,
    )
    return Math.max(
      timeAfter(settledAt, AUTO_SYNC_INTERVAL_MS),
      timeAfter(unsettledAt, AUTO_SYNC_RETRY_MS),
      retryNotBefore,
    )
  }

  const startIfDue = (): boolean => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    // An active run checks again when it ends.
    if (disposed || controller !== null) return false
    const dueAt = nextDueAt()
    if (dueAt === null) return false
    const wait = dueAt - now().getTime()
    if (wait <= 0) {
      start({ full: false })
      return true
    }
    // Timers stall while the computer sleeps; the resume listener checks again.
    timer = setTimeout(checkSchedule, Math.min(wait, AUTO_SYNC_INTERVAL_MS))
    return false
  }

  /** startIfDue for timers and events, where an error has no caller to go to. */
  const checkSchedule = (): void => {
    try {
      startIfDue()
    } catch (error) {
      log.error('sync', 'Could not check whether a sync is due', error)
    }
  }

  const unsubscribeResume = deps.onResume?.(checkSchedule)

  return {
    status: () => current,
    start,
    cancel: () => {
      if (controller === null || controller.signal.aborted) return
      controller.abort()
      publish({ ...current, state: 'cancelling' })
    },
    startIfDue,
    onSettingsChanged: (before, after) => {
      if (disposed) return
      // The list query filters by scope, so the renderer has to load it again.
      if (!sameScope(before.syncBundeslaender, after.syncBundeslaender)) {
        emit('listings:changed', { edictIds: null })
      }
      checkSchedule()
    },
    dispose: async () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      unsubscribeResume?.()
      controller?.abort()
      if (active !== null) await active
    },
  }
}

/** The newest finished run of the source the service syncs, as the list a status carries. */
function readLastRuns(db: AppDatabase): SyncRunSummary[] {
  const run = lastFinishedRun(db, EDICT_SOURCE)
  return run === null ? [] : [run]
}

function idle(lastRuns: SyncRunSummary[]): SyncStatus {
  return { state: 'idle', phase: null, done: 0, total: 0, current: null, lastRuns }
}

/** `at` plus `ms` in ms since the epoch; 0 (due) when there is no valid time. */
function timeAfter(at: string | null, ms: number): number {
  const time = at === null ? Number.NaN : Date.parse(at)
  return Number.isFinite(time) ? time + ms : 0
}

function sameScope(a: readonly Bundesland[], b: readonly Bundesland[]): boolean {
  const other = new Set(b)
  return new Set(a).size === other.size && a.every((bundesland) => other.has(bundesland))
}
