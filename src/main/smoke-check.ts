import { app, type BrowserWindow } from 'electron'
import { log } from './log'

const TIMEOUT_MS = 30_000
const POLL_MS = 200

/**
 * Self-check for packaged builds, enabled with EDIKTE_SMOKE_TEST=1. Exits with
 * code 0 once the renderer has loaded its data through the preload bridge and
 * with 1 on any failure. Release CI uses this instead of Playwright, which
 * needs the Node inspector that the packaged app's fuses switch off.
 *
 * The renderer reports its state in `<html data-startup="ready|failed">`.
 */
export function runSmokeCheck(window: BrowserWindow): void {
  const contents = window.webContents
  let done = false
  const timer = setTimeout(() => finish(1, `No startup result after ${TIMEOUT_MS} ms`), TIMEOUT_MS)

  function finish(code: 0 | 1, reason: string): void {
    if (done) return
    done = true
    clearTimeout(timer)
    if (code === 0) log.info('smoke', reason)
    else log.error('smoke', reason)
    app.exit(code)
  }

  async function poll(): Promise<void> {
    if (done) return
    const state: unknown = await contents.executeJavaScript(
      'document.documentElement.dataset.startup ?? ""',
    )
    if (state === 'ready') finish(0, 'Renderer loaded app info and settings from main')
    else if (state === 'failed') finish(1, 'Renderer showed the startup error')
    else setTimeout(() => void poll().catch(fail), POLL_MS)
  }

  function fail(error: unknown): void {
    finish(1, `Check failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  contents.on('render-process-gone', (_event, details) => {
    finish(1, `Renderer exited: ${details.reason}`)
  })
  contents.on('did-fail-load', (_event, _code, description) => {
    finish(1, `Page failed to load: ${description}`)
  })
  contents.once('did-finish-load', () => void poll().catch(fail))
}
