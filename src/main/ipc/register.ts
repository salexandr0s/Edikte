import { app } from 'electron'
import type { AppInfo } from '@shared/domain'
import { AppError } from '@shared/errors'
import { INVOKE_CHANNELS } from '@shared/ipc-channels'
import type { AppDatabase } from '../db/client'
import { readSettings, updateSettings } from '../db/settings-store'
import { deleteFilter, listSavedFilters, saveFilter, updateUserState } from '../db/user-store'
import type { AppPaths } from '../paths'
import { openExternalUrl } from '../security'
import type { IpcRouter } from './handle'

export interface IpcServices {
  db: AppDatabase
  paths: AppPaths
}

/**
 * Wires IPC channels to services. Channels whose services arrive in the
 * integration phase answer `not_implemented` until then.
 */
export function registerIpcHandlers(router: IpcRouter, services: IpcServices): void {
  const { db, paths } = services

  router.handle('app:getInfo', () => appInfo(paths))
  router.handle('settings:get', () => readSettings(db))
  router.handle('settings:update', (patch) => updateSettings(db, patch))
  router.handle('userState:update', (request) => updateUserState(db, request))
  router.handle('filters:list', () => listSavedFilters(db))
  router.handle('filters:save', (request) => saveFilter(db, request))
  router.handle('filters:delete', ({ id }) => deleteFilter(db, id))
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
