import type {
  AlertConfig,
  AlertRule,
  DeliveryStatus,
  NotificationSummary,
} from '@shared/notifications'
import type { AppDatabase } from '../../db/client'
import { createNotificationStore } from '../../db/notification-store'
import type { EmitEvent } from '../../ipc/events'
import { log } from '../../log'

export interface DesktopAdapter {
  isSupported(): boolean
  show(notification: NotificationSummary | null, onFailed: (error: string) => void): void
  restore(): Promise<void>
  dispose(): void
}

export interface NotificationServiceDeps {
  db: AppDatabase
  emit: EmitEvent
  desktop: DesktopAdapter
  now?: () => Date
  onResume?: (listener: () => void) => () => void
  isSyncing?: () => boolean
}

export interface NotificationService {
  start(): void
  check(options?: { afterSync?: boolean }): Promise<void>
  updateRule(config: AlertConfig): AlertRule
  deliveryStatus(): DeliveryStatus
  testDesktop(): DeliveryStatus
  requestOpen(id: number): void
  pendingOpen(): number | null
  ackOpen(id: number): void
  dispose(): Promise<void>
}

const MINUTE = 60_000

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  const store = createNotificationStore(deps.db)
  const now = deps.now ?? (() => new Date())
  let disposed = false
  let started = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> = Promise.resolve()
  let testStatus: DeliveryStatus | null = null
  let unsubscribeResume: (() => void) | undefined

  const emitChanged = (): void => {
    if (!disposed) deps.emit('notifications:changed', {})
  }

  const deliveryStatus = (): DeliveryStatus => {
    const persisted = store.deliveryStatus(deps.desktop.isSupported())
    return testStatus !== null &&
      (persisted.lastAttemptAt === null ||
        (testStatus.lastAttemptAt ?? '') >= persisted.lastAttemptAt)
      ? testStatus
      : persisted
  }

  const deliverDesktop = (): boolean => {
    const pending = store.pendingDesktop()
    for (const notification of pending) {
      const supported = deps.desktop.isSupported()
      store.setDesktopStatus(notification.id, supported ? 'attempted' : 'unsupported', null, now())
      if (!supported) continue
      try {
        deps.desktop.show(notification, (error) => {
          if (disposed) return
          store.setDesktopStatus(notification.id, 'failed', error.slice(0, 1000), now())
          emitChanged()
        })
      } catch (error) {
        store.setDesktopStatus(notification.id, 'failed', errorMessage(error), now())
      }
    }
    return pending.length > 0
  }

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (disposed || !started) return
    const next = store.nextDueAt()
    // A bounded check also observes settings/filter edits and clock changes.
    const delay =
      next === null ? MINUTE : Math.max(1000, Math.min(MINUTE, Date.parse(next) - now().getTime()))
    timer = setTimeout(() => {
      void check().catch((error: unknown) =>
        log.error('notifications', 'Scheduled check failed', error),
      )
    }, delay)
  }

  const check = (options: { afterSync?: boolean } = {}): Promise<void> => {
    const task = running
      .catch(() => undefined)
      .then(() => {
        if (disposed) return
        try {
          store.reconcileRules(now())
          if (deps.isSyncing?.() === true) return
          store.processDiscoveries(now())
          const created = store.deliverDue(now(), options.afterSync === true)
          const desktopChanged = deliverDesktop()
          if (created.length > 0 || desktopChanged) emitChanged()
        } finally {
          schedule()
        }
      })
    running = task
    return task
  }

  return {
    start: () => {
      if (started || disposed) return
      started = true
      unsubscribeResume = deps.onResume?.(() => {
        void check({ afterSync: true }).catch((error: unknown) =>
          log.error('notifications', 'Wake check failed', error),
        )
      })
      void deps.desktop
        .restore()
        .catch((error: unknown) =>
          log.error('notifications', 'Native history could not be restored', error),
        )
      void check({ afterSync: true }).catch((error: unknown) =>
        log.error('notifications', 'Startup check failed', error),
      )
    },
    check,
    updateRule: (config) => {
      const rule = store.updateRule(config, now())
      deps.emit('alerts:changed', {})
      schedule()
      return rule
    },
    deliveryStatus,
    testDesktop: () => {
      const supported = deps.desktop.isSupported()
      testStatus = {
        supported,
        lastAttemptAt: now().toISOString(),
        lastStatus: supported ? 'attempted' : 'unsupported',
        lastError: null,
      }
      if (supported) {
        try {
          deps.desktop.show(null, (error) => {
            if (disposed || testStatus === null) return
            testStatus = { ...testStatus, lastStatus: 'failed', lastError: error.slice(0, 1000) }
            emitChanged()
          })
        } catch (error) {
          testStatus = { ...testStatus, lastStatus: 'failed', lastError: errorMessage(error) }
        }
      }
      return deliveryStatus()
    },
    requestOpen: (id) => {
      if (disposed) return
      store.requestOpen(id, now())
      deps.emit('notifications:open', { id })
    },
    pendingOpen: () => store.pendingOpen(),
    ackOpen: (id) => store.ackOpen(id),
    dispose: async () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      unsubscribeResume?.()
      deps.desktop.dispose()
      await running.catch(() => undefined)
    },
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000)
}
