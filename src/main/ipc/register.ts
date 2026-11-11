import { app } from 'electron'
import type { AppInfo } from '@shared/domain'
import { AppError } from '@shared/errors'
import { INVOKE_CHANNELS } from '@shared/ipc-channels'
import type { AppDatabase } from '../db/client'
import { getListing, queryListings } from '../db/listing-store'
import { getDashboard } from '../db/dashboard-store'
import { queryListingCollection } from '../db/collection-store'
import { createNotificationStore } from '../db/notification-store'
import { deleteFilter, listSavedFilters, saveFilter, updateUserState } from '../db/user-store'
import type { AppPaths } from '../paths'
import { openExternalUrl } from '../security'
import type { AnalysisService } from '../services/analysis'
import type { DocumentService } from '../services/documents'
import type { GeocodeService } from '../services/geocode'
import { registerProviderHandlers, type ProviderService } from '../services/providers'
import type { SettingsService } from '../services/settings'
import type { SyncService } from '../services/sync'
import type { NotificationService } from '../services/notifications'
import type { EmitEvent } from './events'
import { log } from '../log'
import type { IpcRouter } from './handle'

export interface IpcServices {
  db: AppDatabase
  paths: AppPaths
  settings: SettingsService
  sync: SyncService
  geocode: GeocodeService
  providers: ProviderService
  documents: DocumentService
  analysis: AnalysisService
  notifications: NotificationService
  emit: EmitEvent
}

/**
 * Wires IPC channels to services. A contract entry added later without a
 * handler answers `not_implemented` instead of leaving the renderer waiting.
 */
export function registerIpcHandlers(router: IpcRouter, services: IpcServices): void {
  const { db, paths, settings, sync, geocode, documents, analysis, notifications, emit } = services
  const notificationStore = createNotificationStore(db)

  router.handle('app:getInfo', () => appInfo(paths))
  router.handle('settings:get', () => settings.read())
  router.handle('settings:update', (patch) => settings.update(patch))

  router.handle('sync:start', ({ full }) => sync.start({ full }))
  router.handle('sync:cancel', () => {
    sync.cancel()
    return sync.status()
  })
  router.handle('sync:status', () => sync.status())

  router.handle('listings:query', (query) => queryListings(db, query))
  router.handle('listings:queryCollection', (collection) => queryListingCollection(db, collection))
  router.handle('dashboard:get', (request) => getDashboard(db, request))
  router.handle('alerts:get', ({ filterId }) => notificationStore.getRule(filterId))
  router.handle('alerts:update', (request) => notifications.updateRule(request))
  router.handle('notifications:list', (request) => notificationStore.listNotifications(request))
  router.handle('notifications:get', ({ id }) => notificationStore.getNotification(id))
  router.handle('notifications:markRead', ({ id }) => {
    notificationStore.markRead(id)
    emit('notifications:changed', {})
  })
  router.handle('notifications:markAllRead', () => {
    notificationStore.markAllRead()
    emit('notifications:changed', {})
  })
  router.handle('notifications:deliveryStatus', () => notifications.deliveryStatus())
  router.handle('notifications:testDesktop', () => notifications.testDesktop())
  router.handle('notifications:pendingOpen', () => notifications.pendingOpen())
  router.handle('notifications:ackOpen', ({ id }) => notifications.ackOpen(id))
  router.handle('listings:get', ({ id }) => getListing(db, id))
  router.handle('geocode:run', () => geocode.run())
  router.handle('userState:update', (request) => {
    const state = updateUserState(db, request)
    emit('listings:changed', { edictIds: null })
    return state
  })
  router.handle('filters:list', () => listSavedFilters(db))
  router.handle('filters:save', (request) => {
    const result = db.transaction(() => {
      const filter = saveFilter(db, request)
      notificationStore.reconcileRules()
      return filter
    })
    emit('filters:changed', {})
    emit('alerts:changed', {})
    void notifications
      .check()
      .catch((error: unknown) => log.error('notifications', 'Filter check failed', error))
    return result
  })
  router.handle('filters:delete', ({ id }) => {
    db.transaction(() => {
      deleteFilter(db, id)
      notificationStore.reconcileRules()
    })
    emit('filters:changed', {})
    emit('alerts:changed', {})
    void notifications
      .check()
      .catch((error: unknown) => log.error('notifications', 'Filter check failed', error))
  })

  router.handle('documents:download', (request) => documents.download(request))
  router.handle('documents:open', (request) => documents.open(request))
  router.handle('documents:planFill', (query) => documents.planFill(query))
  router.handle('documents:fill', (query) => documents.fill(query))
  router.handle('documents:cancelFill', () => documents.cancelFill())

  router.handle('analysis:estimate', (request) => analysis.estimate(request))
  router.handle('analysis:start', (request) => analysis.start(request))
  router.handle('analysis:cancel', (request) => analysis.cancel(request))
  router.handle('analysis:list', (request) => analysis.list(request))

  registerProviderHandlers(router, services.providers)
  router.handle('shell:openExternal', ({ url }) => openExternalUrl(url))

  for (const channel of INVOKE_CHANNELS) {
    if (router.has(channel)) continue
    router.handle(channel, () => {
      throw new AppError('not_implemented', `${channel} is not available yet`)
    })
  }
}

function appInfo(paths: AppPaths): AppInfo {
  const platform = process.platform
  if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') {
    throw new AppError('internal', `Unsupported platform ${platform}`)
  }
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    electronVersion: process.versions.electron ?? 'unknown',
    systemLocale: app.getSystemLocale(),
    dataDir: paths.userData,
  }
}
