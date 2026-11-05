import { app, dialog } from 'electron'
import { AppError, type AppErrorCode } from '@shared/errors'
import de from '../renderer/src/i18n/de.json'
import en from '../renderer/src/i18n/en.json'

/**
 * Tells the user why the app is closing. Without it, a failed start (for
 * example a data folder from a newer version) ends with no window at all.
 * The text comes from the renderer translations in the system language.
 */
export function showStartupError(error: unknown): void {
  const strings = app.getLocale().toLowerCase().startsWith('de') ? de : en
  const code: AppErrorCode = error instanceof AppError ? error.code : 'internal'
  dialog.showErrorBox(strings.startup.failed, strings.errors[code])
}
