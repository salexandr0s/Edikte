import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { BrowserWindow, session, type CustomScheme, type Session } from 'electron'
import { AppError } from '@shared/errors'
import {
  DOCUMENT_SCHEME,
  documentUrl,
  localPathFromUrl,
  resolveDocumentFile,
} from './document-protocol'

// PDF window: Chromium's built-in viewer, fed through a custom scheme that only
// serves files inside the documents folder, opened at "#page=N".

/** In-memory session of the PDF windows. Only this session serves the scheme. */
const PDF_PARTITION = 'edikte-pdf'
const BLOCKED_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:'])

/** Registered in main's single registerSchemesAsPrivileged call before the app is ready. */
export const DOCUMENT_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: DOCUMENT_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}

/** Serves the documents folder to PDF windows. Call once, after the app is ready. */
export function installDocumentProtocol(documentsDir: string): void {
  const pdfSession = session.fromPartition(PDF_PARTITION)
  guardSession(pdfSession)
  pdfSession.protocol.handle(DOCUMENT_SCHEME, (request) => serveDocument(documentsDir, request))
}

async function serveDocument(documentsDir: string, request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405 })
  }
  const localPath = localPathFromUrl(request.url)
  const file = localPath === null ? null : await resolveDocumentFile(documentsDir, localPath)
  if (file === null) return new Response(null, { status: 404 })
  const { size } = await stat(file)
  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Length': String(size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  if (request.method === 'HEAD') return new Response(null, { headers })
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>
  return new Response(body, { headers })
}

/** The viewer needs no permissions and no network; files come through the scheme. */
function guardSession(target: Session): void {
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  target.setPermissionCheckHandler(() => false)
  target.webRequest.onBeforeRequest((details, callback) => {
    let blocked = true
    try {
      blocked = BLOCKED_PROTOCOLS.has(new URL(details.url).protocol)
    } catch {
      // Unparsable addresses stay blocked.
    }
    callback({ cancel: blocked })
  })
}

export interface OpenPdfOptions {
  /** The documents folder (AppPaths.documents). */
  documentsDir: string
  /** documents.localPath: `<edictId>/<file>.pdf`. */
  localPath: string
  /** 1-based PDF page to open at. */
  page?: number
  title?: string
}

const openWindows = new Map<string, BrowserWindow>()
let reloadCounter = 0

/**
 * Opens a downloaded PDF in an app window at the given page. A second request
 * for the same file reuses its window and jumps to the new page.
 */
export async function openPdfWindow(options: OpenPdfOptions): Promise<void> {
  if ((await resolveDocumentFile(options.documentsDir, options.localPath)) === null) {
    throw new AppError('not_found', 'The document file is missing')
  }
  const url = documentUrl(options.localPath, options.page)
  const existing = openWindows.get(options.localPath)
  if (existing !== undefined && !existing.isDestroyed()) {
    // A changed query makes the viewer load again; a changed #page alone does not.
    reloadCounter += 1
    await loadViewer(existing, url.replace('#', `?v=${reloadCounter}#`))
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return
  }
  const window = new BrowserWindow({
    width: 1000,
    height: 1100,
    minWidth: 480,
    minHeight: 400,
    title: options.title ?? 'Gutachten',
    autoHideMenuBar: true,
    webPreferences: {
      // No preload: the viewer gets no bridge to the main process.
      partition: PDF_PARTITION,
      plugins: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  openWindows.set(options.localPath, window)
  window.on('closed', () => {
    if (openWindows.get(options.localPath) === window) openWindows.delete(options.localPath)
  })
  // Keep the app's title instead of the one inside the PDF.
  window.on('page-title-updated', (event) => event.preventDefault())
  await loadViewer(window, url)
}

async function loadViewer(window: BrowserWindow, url: string): Promise<void> {
  try {
    await window.loadURL(url)
  } catch (error) {
    // The viewer takes over the navigation, which Chromium can report as aborted.
    if (!(error instanceof Error && error.message.includes('ERR_ABORTED'))) throw error
  }
}
