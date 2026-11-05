import type { Settings, SyncRunSummary, SyncStatus } from '@shared/domain'
import { AppError } from '@shared/errors'
import type { AppDatabase } from '../../db/client'
import {
  closeOpenRuns,
  createSyncStore,
  lastFinishedRun,
  lastSettledRunFinishedAt,
} from '../../db/sync-store'
import type { EmitEvent } from '../../ipc/events'
import { log } from '../../log'
import type { PageSource } from '../../scraper/client'
import { runSync } from '../../scraper/sync'

const HOUR_MS = 60 * 60 * 1000

/**
 * An automatic sync starts when the last run over the scope that got an
 * answer from the site finished this long ago. Whether a run lists everything
 * (once a day) is decided by `runSync`.
 */
export const AUTO_SYNC_INTERVAL_MS = 6 * HOUR_MS

const INTERRUPTED_NOTE = 'The app closed during this sync'
const STORAGE_FAILED_NOTE = 'The sync result could not be saved'

export interface SyncServiceDeps {
  db: AppDatabase
  /** The app's shared client, so every request shares one rate limit. */
  source: PageSource
  emit: EmitEvent
  readSettings: () => Pick<Settings, 'syncBundeslaender' | 'autoSync'>
  now?: () => Date
}

export interface SyncService {
  status(): SyncStatus
  /** Starts a run over the scope in the settings. Throws `busy` while one is active. */
  start(options: { full: boolean }): SyncStatus
  /** Asks the active run to stop; it ends as cancelled and writes nothing. */
  cancel(): void
  /** Starts an incremental run when auto sync is on and one is due. */
  startIfDue(): boolean
  /** Cancels an active run and resolves once it has stopped writing. */
  dispose(): Promise<void>
}

export function createSyncService(deps: SyncServiceDeps): SyncService {
  const { db, source, emit } = deps
  const now = deps.now ?? (() => new Date())
  const store = createSyncStore(db)
  // No run can be active yet: one still marked running was cut off by a quit.
  closeOpenRuns(db, { status: 'cancelled', note: INTERRUPTED_NOTE, finishedAt: null })

  let current: SyncStatus = idle(lastFinishedRun(db))
  let controller: AbortController | null = null
  let active: Promise<void> | null = null
  let disposed = false

  const publish = (status: SyncStatus): void => {
    current = status
    if (!disposed) emit('sync:progress', status)
  }

  const execute = async (
    scope: Settings['syncBundeslaender'],
    full: boolean,
    signal: AbortSignal,
  ) => {
    try {
      const summary = await runSync({
        source,
        store,
        scope,
        signal,
        forceFull: full,
        now,
        onProgress: publish,
      })
      if (summary.status === 'ok' && !disposed) emit('listings:changed', { edictIds: null })
    } catch (error) {
      // runSync handles site errors itself; what reaches here is a storage error.
      log.error('sync', 'The sync could not be stored', error)
      let lastFinished = current.lastFinished
      try {
        closeOpenRuns(db, {
          status: 'failed',
          note: STORAGE_FAILED_NOTE,
          finishedAt: now().toISOString(),
        })
        lastFinished = lastFinishedRun(db)
      } catch (cleanupError) {
        log.error('sync', 'The failed sync could not be closed', cleanupError)
      }
      publish(idle(lastFinished))
    }
  }

  const start = ({ full }: { full: boolean }): SyncStatus => {
    if (disposed) throw new AppError('cancelled', 'The app is closing')
    if (controller !== null) throw new AppError('busy', 'A sync is already running')
    const scope = [...deps.readSettings().syncBundeslaender]
    const abort = new AbortController()
    controller = abort
    publish({ ...idle(current.lastFinished), state: 'running' })
    active = execute(scope, full, abort.signal).finally(() => {
      controller = null
      active = null
    })
    return current
  }

  return {
    status: () => current,
    start,
    cancel: () => {
      if (controller === null || controller.signal.aborted) return
      controller.abort()
      publish({ ...current, state: 'cancelling' })
    },
    startIfDue: () => {
      if (disposed || controller !== null) return false
      const settings = deps.readSettings()
      if (!settings.autoSync) return false
      const finishedAt = lastSettledRunFinishedAt(db, settings.syncBundeslaender)
      if (finishedAt !== null && now().getTime() - Date.parse(finishedAt) < AUTO_SYNC_INTERVAL_MS) {
        return false
      }
      start({ full: false })
      return true
    },
    dispose: async () => {
      disposed = true
      controller?.abort()
      if (active !== null) await active
    },
  }
}

function idle(lastFinished: SyncRunSummary | null): SyncStatus {
  return { state: 'idle', phase: null, done: 0, total: 0, current: null, lastFinished }
}
