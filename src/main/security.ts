import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, shell, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron'
import { AppError } from '@shared/errors'

// Hosts the renderer may open in the system browser. Main-process flows such
// as the ChatGPT sign-in open their own URLs and do not go through this list.
const EXTERNAL_HOSTS = new Set([
  'edikte.justiz.gv.at',
  'www.justiz.gv.at',
  'chatgpt.com',
  'platform.openai.com',
  'help.openai.com',
  'claude.ai',
  'console.anthropic.com',
  'docs.anthropic.com',
  'code.claude.com',
  'github.com',
])

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    EXTERNAL_HOSTS.has(url.hostname)
  )
}

export async function openExternalUrl(raw: string): Promise<void> {
  if (!isAllowedExternalUrl(raw)) {
    throw new AppError('forbidden', 'This address cannot be opened from the app')
  }
  await shell.openExternal(new URL(raw).toString())
}

export interface RendererTrust {
  /** Origin of the Vite dev server, only in development. */
  devServerOrigin: string | null
  /** True for the app's own renderer page and nothing else. */
  isTrustedUrl(url: string): boolean
}

export function createRendererTrust(options: {
  devServerUrl: string | null
  rendererIndexFile: string
}): RendererTrust {
  const devServerOrigin = options.devServerUrl ? new URL(options.devServerUrl).origin : null
  const indexFile = path.resolve(options.rendererIndexFile)
  return {
    devServerOrigin,
    isTrustedUrl(raw) {
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        return false
      }
      if (devServerOrigin !== null) {
        return (
          url.origin === devServerOrigin && (url.pathname === '/' || url.pathname === '/index.html')
        )
      }
      return url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === indexFile
    },
  }
}

/**
 * IPC sender check, ported from openfit's assertTrustedSender: the request must
 * come from the main frame of the expected window, showing the app's own page.
 */
export function isTrustedSender(
  event: IpcMainInvokeEvent,
  expected: WebContents | null,
  trust: RendererTrust,
): boolean {
  const frame = event.senderFrame
  return (
    expected !== null &&
    !expected.isDestroyed() &&
    event.sender === expected &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    trust.isTrustedUrl(frame.url)
  )
}

/** Blocks pop-ups, navigation away from the app page and <webview> in every window. */
export function installAppGuards(trust: RendererTrust): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (!trust.isTrustedUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!trust.isTrustedUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

/**
 * Denies permission requests and keeps renderer pages off the network. Requests
 * made by the main process (Node fetch) have no web contents and are not affected.
 */
export function installSessionGuards(target: Session, trust: RendererTrust): void {
  target.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && trust.isTrustedUrl(details.requestingUrl))
  })
  target.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && trust.isTrustedUrl(requestingOrigin)
  })
  target.webRequest.onBeforeRequest((details, callback) => {
    if (details.webContentsId === undefined) {
      callback({})
      return
    }
    callback({ cancel: !isAllowedRendererRequest(details.url, trust.devServerOrigin) })
  })
}

function isAllowedRendererRequest(raw: string, devServerOrigin: string | null): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return true
  return devServerOrigin !== null && url.host === new URL(devServerOrigin).host
}
