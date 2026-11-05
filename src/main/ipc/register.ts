import { app } from 'electron'
import type { AppInfo } from '@shared/domain'
import { AppError } from '@shared/errors'
import { INVOKE_CHANNELS } from '@shared/ipc-channels'
import type { AppDatabase } from '../db/client'
import { getListing, queryListings } from '../db/listing-store'
import { deleteFilter, listSavedFilters, saveFilter, updateUserState } from '../db/user-store'
import type { AppPaths } from '../paths'
import { openExternalUrl } from '../security'
import type { AnalysisService } from '../services/analysis'
import type { DocumentService } from '../services/documents'
import type { GeocodeService } from '../services/geocode'
import { registerProviderHandlers, type ProviderService } from '../services/providers'
import type { SettingsService } from '../services/settings'
import type { SyncService } from '../services/sync'
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
}

/**
 * Wires IPC channels to services. A contract entry added later without a
 * handler answers `not_implemented` instead of leaving the renderer waiting.
 */
export function registerIpcHandlers(router: IpcRouter, services: IpcServices): void {
  const { db, paths, settings, sync, geocode, documents, analysis } = services

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
  router.handle('listings:get', ({ id }) => getListing(db, id))
  router.handle('geocode:run', () => geocode.run())
  router.handle('userState:update', (request) => updateUserState(db, request))
  router.handle('filters:list', () => listSavedFilters(db))
  router.handle('filters:save', (request) => saveFilter(db, request))
  router.handle('filters:delete', ({ id }) => deleteFilter(db, id))

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
