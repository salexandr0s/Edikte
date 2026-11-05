import path from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, session, type OpenDialogOptions } from 'electron'
import type { Settings } from '@shared/domain'
import { openDatabase, type AppDatabase } from './db/client'
import { createDocumentStore } from './db/document-store'
import { queryListings } from './db/listing-store'
import { ensurePresetFilters } from './db/user-store'
import {
  extractInUtilityProcess,
  installDocumentProtocol,
  openPdfWindow,
  rasterPageLocation,
  registerDocumentScheme,
  renderPdfPages,
} from './documents'
import { createEventEmitter } from './ipc/events'
import { createIpcRouter } from './ipc/handle'
import { registerIpcHandlers } from './ipc/register'
import { log } from './log'
import { resolveAppPaths } from './paths'
import { EdikteClient, userAgent } from './scraper/client'
import { createSafeStorageEncryption } from './secure/safe-storage'
import {
  createRendererTrust,
  installAppGuards,
  installSessionGuards,
  isTrustedSender,
  openSignInUrl,
} from './security'
import { createAnalysisService, type AnalysisService } from './services/analysis'
import { createDocumentService, type DocumentService } from './services/documents'
import { createProviderService, type ProviderService } from './services/providers'
import { createSettingsService } from './services/settings'
import { createSyncService, type SyncService } from './services/sync'
import { runSmokeCheck } from './smoke-check'
import { showStartupError } from './startup-error'

// Before anything reads app paths or safeStorage: both derive from the name.
app.setName('Edikte')
// Tests and the packaged-app smoke check point the app at a scratch folder.
const userDataOverride = process.env.EDIKTE_USER_DATA_DIR
if (userDataOverride) app.setPath('userData', userDataOverride)
const smokeTest = process.env.EDIKTE_SMOKE_TEST === '1'
// Offline: no sync on its own and no CLI started by detection. The e2e test and
// the self-check run this way; requests the user starts still go out.
const offline = smokeTest || process.env.EDIKTE_OFFLINE === '1'
app.enableSandbox()
// The PDF window's scheme must be registered before the app is ready.
registerDocumentScheme()

const devServerUrl = app.isPackaged ? null : (process.env.ELECTRON_RENDERER_URL ?? null)
const rendererIndexFile = path.join(import.meta.dirname, '../renderer/index.html')
const preloadFile = path.join(import.meta.dirname, '../preload/index.cjs')
const trust = createRendererTrust({ devServerUrl, rendererIndexFile })
const SHUTDOWN_LIMIT_MS = 5000

interface Services {
  sync: SyncService
  providers: ProviderService
  documents: DocumentService
  analysis: AnalysisService
}

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let services: Services | null = null
let shutdown: 'none' | 'running' | 'done' = 'none'

if (!app.requestSingleInstanceLock()) {
  // Usually another instance is running. The lock also fails when the data
  // folder is unusable, so the self-check must not report that as a pass.
  if (smokeTest) fail(new Error('Could not take the single-instance lock'))
  else app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  installAppGuards(trust)
  // catch() also covers errors thrown inside start(), such as a database from a newer version.
  // Without it the process would stay alive with no window and hold the single-instance lock.
  app.whenReady().then(start).catch(fail)
}

function start(): void {
  installSessionGuards(session.defaultSession, trust)
  const paths = resolveAppPaths(app.getPath('userData'))
  const db = openDatabase(paths.database)
  database = db
  ensurePresetFilters(db)
  installDocumentProtocol(paths.documents)

  const emit = createEventEmitter(() => mainWindow)
  // One client for every request to the site, so all of them share one rate limit.
  const client = new EdikteClient({ appVersion: app.getVersion() })
  const settings = createSettingsService(db, (before, after) => settingsChanged(before, after))
  const sync = createSyncService({ db, source: client, emit, readSettings: () => settings.read() })
  const providers = createProviderService({
    db,
    emit,
    encryption: createSafeStorageEncryption(),
    paths,
    openExternal: openSignInUrl,
    chooseFile: chooseCliBinary,
    offline,
  })
  const documentStore = createDocumentStore(db)
  const documents = createDocumentService({
    store: documentStore,
    documentsDir: paths.documents,
    emit,
    extract: (file, signal) => extractInUtilityProcess(file, { signal }),
    fetch: client.limitedFetch,
    userAgent: userAgent(app.getVersion()),
    openPdf: openPdfWindow,
    queryListings: (query) => queryListings(db, query),
    retentionDays: () => settings.read().documentRetentionDays,
  })
  const rasterLocation = rasterPageLocation(import.meta.dirname, devServerUrl)
  const analysis = createAnalysisService({
    db,
    store: documentStore,
    documents,
    providers,
    emit,
    settings: () => settings.read(),
    documentsDir: paths.documents,
    renderPdf: (options) => renderPdfPages({ ...options, location: rasterLocation }),
  })
  services = { sync, providers, documents, analysis }

  const router = createIpcRouter((event) =>
    isTrustedSender(event, mainWindow?.webContents ?? null, trust),
  )
  registerIpcHandlers(router, { db, paths, settings, sync, providers, documents, analysis })

  mainWindow = createMainWindow()
  if (smokeTest) runSmokeCheck(mainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })

  // Detection runs CLIs, so it waits for the window; failures end up in each status.
  void providers
    .detect()
    .catch((error: unknown) => log.error('providers', 'Detection failed', error))
  void documents
    .runRetention()
    .catch((error: unknown) => log.error('documents', 'Retention failed', error))
  if (!offline) {
    // Jobs left queued by the last session; offline they would only fail without a provider.
    void analysis
      .resumeQueued()
      .catch((error: unknown) => log.error('analysis', 'Queued jobs did not resume', error))
    if (settings.read().firstRunCompletedAt !== null) sync.startIfDue()
  }

  /** Main's reactions to settings the renderer saved. */
  function settingsChanged(before: Settings, after: Settings): void {
    if (offline || after.firstRunCompletedAt === null) return
    const firstRunDone = before.firstRunCompletedAt === null
    const scopeChanged = before.syncBundeslaender.join() !== after.syncBundeslaender.join()
    const autoSyncOn = !before.autoSync && after.autoSync
    // startIfDue checks auto sync itself; a new scope has no finished run yet, so it is due.
    if (firstRunDone || scopeChanged || autoSyncOn) sync.startIfDue()
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Edikte',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0A0A0B' : '#FFFFFF',
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  if (devServerUrl !== null) void window.loadURL(devServerUrl)
  else void window.loadFile(rendererIndexFile)
  return window
}

/** The file dialog for a CLI binary chosen in Settings. Null when the user closes it. */
async function chooseCliBinary(): Promise<string | null> {
  const options: OpenDialogOptions = { properties: ['openFile', 'dontAddToRecent'] }
  const result =
    mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

function fail(error: unknown): void {
  log.error('app', 'Startup failed', error)
  // The self-check reports through its exit code; a modal dialog would block it.
  if (!smokeTest && app.isReady()) showStartupError(error)
  app.exit(1)
}

/**
 * Stops sign-ins, the sync, analyses and downloads, waits a few seconds for
 * them to stop writing, then closes the database. Queued analyses stay queued.
 */
async function stopServices(db: AppDatabase, running: Services | null): Promise<void> {
  if (running !== null) {
    running.providers.dispose()
    running.documents.cancelFill()
    const stopped = Promise.allSettled([running.sync.dispose(), running.analysis.shutdown()])
      .then(() => running.documents.idle())
      .catch((error: unknown) => log.error('app', 'Services did not stop cleanly', error))
    const limit = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_LIMIT_MS))
    await Promise.race([stopped, limit])
  }
  db.$client.close()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', (event) => {
  if (database === null || shutdown === 'done') return
  event.preventDefault()
  if (shutdown === 'running') return
  shutdown = 'running'
  // Every window is closed by now. A second app.quit() from here is ignored
  // while the first quit is still in progress, so the process ends with exit().
  void stopServices(database, services).finally(() => {
    shutdown = 'done'
    database = null
    services = null
    app.exit(0)
  })
})
