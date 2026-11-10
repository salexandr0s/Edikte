import type { Settings, SyncRunSummary, SyncStatus } from '@shared/domain'
import { EdictSourceSchema, type Bundesland, type EdictSource } from '@shared/enums'
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
import { createAuctionSite } from '../../scraper/auction-site'
import type { JsonSource, PageSource } from '../../scraper/client'
import { createInsolvencySite } from '../../scraper/insolvency/site'
import { runSync } from '../../scraper/sync'
import type { SyncRow, SyncSite } from '../../scraper/sync-site'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

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
export type SyncSettings = Pick<
  Settings,
  'syncBundeslaender' | 'syncSources' | 'autoSync' | 'firstRunCompletedAt'
>

export interface SyncServiceDeps {
  db: AppDatabase
  /** The app's shared client, so every request shares one rate limit. */
  source: PageSource & JsonSource
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

  const lastRuns = (): SyncRunSummary[] => readLastRuns(db, deps.readSettings().syncSources)
  let current: SyncStatus = idle(lastRuns())
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

  const execute = async (
    scope: Bundesland[],
    sources: EdictSource[],
    full: boolean,
    signal: AbortSignal,
  ) => {
    let changed = false
    const runSite = <Row extends SyncRow, Page>(site: SyncSite<Row, Page>) =>
      runSync({
        site,
        store,
        scope,
        signal,
        forceFull: full,
        now,
        onProgress: (progress) => {
          publish({
            ...progress,
            state: signal.aborted ? 'cancelling' : 'running',
            lastRuns: current.lastRuns,
          })
        },
      })
    try {
      for (const edictSource of sources) {
        if (signal.aborted) break
        const summary =
          edictSource === 'court_auction'
            ? await runSite(createAuctionSite(source))
            : await runSite(createInsolvencySite(source))
        changed ||= summary.status === 'ok'
        // Keep the pass running while exposing each source's finished result.
        publish({ ...current, lastRuns: lastRuns() })
      }
    } catch (error) {
      // runSync handles site errors itself; what reaches here is a storage error.
      log.error('sync', 'The sync could not be stored', error)
      retryNotBefore = now().getTime() + AUTO_SYNC_RETRY_MS
      try {
        closeOpenRuns(db, {
          status: 'failed',
          note: STORAGE_FAILED_NOTE,
          finishedAt: now().toISOString(),
          failureCode: 'storage_unavailable',
        })
      } catch (cleanupError) {
        log.error('sync', 'The failed sync could not be closed', cleanupError)
      }
    } finally {
      let finishedRuns = current.lastRuns
      try {
        finishedRuns = lastRuns()
      } catch (error) {
        log.error('sync', 'The finished sync runs could not be read', error)
      }
      publish(idle(finishedRuns))
      if (changed && !disposed) emit('listings:changed', { edictIds: null })
    }
  }

  const startPass = (full: boolean, sources: EdictSource[]): SyncStatus => {
    if (disposed) throw new AppError('cancelled', 'The app is closing')
    if (controller !== null) throw new AppError('busy', 'A sync is already running')
    const scope = [...deps.readSettings().syncBundeslaender]
    const abort = new AbortController()
    controller = abort
    publish({ ...idle(current.lastRuns), state: 'running' })
    active = execute(scope, sources, full, abort.signal).finally(() => {
      controller = null
      active = null
      // The next due time moved, and the settings may have changed during the run.
      if (!disposed) checkSchedule()
    })
    return current
  }

  const start = ({ full }: { full: boolean }): SyncStatus =>
    startPass(full, enabledSources(deps.readSettings().syncSources))

  /** Each enabled source has its own settled run and retry schedule. */
  const schedule = (): Array<{ source: EdictSource; dueAt: number }> => {
    if (deps.offline === true) return []
    const settings = deps.readSettings()
    if (!settings.autoSync || settings.firstRunCompletedAt === null) return []
    return enabledSources(settings.syncSources).map((edictSource) => {
      const { settledAt, unsettledAt } = loadSyncSchedule(
        db,
        settings.syncBundeslaender,
        edictSource,
      )
      return {
        source: edictSource,
        dueAt: Math.max(
          timeAfter(settledAt, AUTO_SYNC_INTERVAL_MS),
          timeAfter(unsettledAt, AUTO_SYNC_RETRY_MS),
          retryNotBefore,
        ),
      }
    })
  }

  const startIfDue = (): boolean => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    // An active run checks again when it ends.
    if (disposed || controller !== null) return false
    const scheduled = schedule()
    if (scheduled.length === 0) return false
    const time = now().getTime()
    const due = scheduled.filter((item) => item.dueAt <= time)
    if (due.length > 0) {
      startPass(
        false,
        due.map((item) => item.source),
      )
      return true
    }
    const wait = Math.min(...scheduled.map((item) => item.dueAt)) - time
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
      // A source not reached in this pass is still due. Give cancellation the
      // same pause as a cancelled run before auto sync considers it again.
      retryNotBefore = now().getTime() + AUTO_SYNC_RETRY_MS
      controller.abort()
      publish({ ...current, state: 'cancelling' })
    },
    startIfDue,
    onSettingsChanged: (before, after) => {
      if (disposed) return
      // The list query filters by scope, so the renderer has to load it again.
      if (
        !sameMembers(before.syncBundeslaender, after.syncBundeslaender) ||
        !sameMembers(before.syncSources, after.syncSources)
      ) {
        emit('listings:changed', { edictIds: null })
        publish({ ...current, lastRuns: lastRuns() })
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

/** Newest finished run of each enabled source, in the order a pass reads them. */
function readLastRuns(db: AppDatabase, sources: readonly EdictSource[]): SyncRunSummary[] {
  return enabledSources(sources).flatMap((source) => {
    const run = lastFinishedRun(db, source)
    return run === null ? [] : [run]
  })
}

function enabledSources(sources: readonly EdictSource[]): EdictSource[] {
  return EdictSourceSchema.options.filter((source) => sources.includes(source))
}

function idle(lastRuns: SyncRunSummary[]): SyncStatus {
  return { state: 'idle', phase: null, done: 0, total: 0, current: null, lastRuns }
}

/** `at` plus `ms` in ms since the epoch; 0 (due) when there is no valid time. */
function timeAfter(at: string | null, ms: number): number {
  const time = at === null ? Number.NaN : Date.parse(at)
  return Number.isFinite(time) ? time + ms : 0
}

function sameMembers<T>(a: readonly T[], b: readonly T[]): boolean {
  const other = new Set(b)
  return new Set(a).size === other.size && a.every((bundesland) => other.has(bundesland))
}
