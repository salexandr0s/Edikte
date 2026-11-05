import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  powerMonitor,
  protocol,
  session,
  type OpenDialogOptions,
} from 'electron'
import { openDatabase, type AppDatabase } from './db/client'
import { createDocumentStore } from './db/document-store'
import { queryListings } from './db/listing-store'
import { ensurePresetFilters } from './db/user-store'
import {
  DOCUMENT_SCHEME_PRIVILEGES,
  extractInUtilityProcess,
  installDocumentProtocol,
  openPdfWindow,
  rasterPageLocation,
  renderPdfPages,
} from './documents'
import { createNominatimGeocoder, NOMINATIM_PROVIDER } from './geocode'
import { createEventEmitter } from './ipc/events'
import { createIpcRouter } from './ipc/handle'
import { registerIpcHandlers } from './ipc/register'
import { log } from './log'
import { installTileProtocol, TILE_SCHEME_PRIVILEGES } from './map'
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
import { createGeocodeService, type GeocodeService } from './services/geocode'
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
// Electron honours one such call, and only before the app is ready: the PDF
// window's scheme and the map tile scheme go in together.
protocol.registerSchemesAsPrivileged([DOCUMENT_SCHEME_PRIVILEGES, TILE_SCHEME_PRIVILEGES])

const devServerUrl = app.isPackaged ? null : (process.env.ELECTRON_RENDERER_URL ?? null)
const rendererIndexFile = path.join(import.meta.dirname, '../renderer/index.html')
const preloadFile = path.join(import.meta.dirname, '../preload/index.cjs')
// Packaged apps carry the icon in the bundle. In development Electron's own
// binary runs, so the Dock and the window take it from build/.
const devIcon = app.isPackaged
  ? undefined
  : path.join(
      import.meta.dirname,
      '../../build',
      process.platform === 'win32' ? 'icon.ico' : 'icon.png',
    )
const trust = createRendererTrust({ devServerUrl, rendererIndexFile })
const SHUTDOWN_LIMIT_MS = 5000

interface Services {
  sync: SyncService
  geocode: GeocodeService
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
  if (devIcon !== undefined) app.dock?.setIcon(devIcon)
  const paths = resolveAppPaths(app.getPath('userData'))
  const db = openDatabase(paths.database)
  database = db
  ensurePresetFilters(db)
  installDocumentProtocol(paths.documents)
  installTileProtocol(session.defaultSession, {
    tilesDir: paths.tiles,
    userAgent: userAgent(app.getVersion()),
  })

  const emit = createEventEmitter(() => mainWindow)
  // One client for every request to the site, so all of them share one rate limit.
  const client = new EdikteClient({ appVersion: app.getVersion() })
  // Main's reaction to saved settings: a new scope reloads the list, and auto sync may now be due.
  const settings = createSettingsService(db, (before, after) =>
    sync.onSettingsChanged(before, after),
  )
  const sync = createSyncService({
    db,
    source: client,
    emit,
    readSettings: () => settings.read(),
    offline,
    onResume: (listener) => {
      powerMonitor.on('resume', listener)
      return () => powerMonitor.off('resume', listener)
    },
  })
  // Addresses are looked up when the map view asks for them, never on their own.
  const geocode = createGeocodeService({
    db,
    geocoder: createNominatimGeocoder({ userAgent: userAgent(app.getVersion()) }),
    provider: NOMINATIM_PROVIDER,
    emit,
    readSettings: () => settings.read(),
    offline,
  })
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
  services = { sync, geocode, providers, documents, analysis }

  const router = createIpcRouter((event) =>
    isTrustedSender(event, mainWindow?.webContents ?? null, trust),
  )
  registerIpcHandlers(router, {
    db,
    paths,
    settings,
    sync,
    geocode,
    providers,
    documents,
    analysis,
  })

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
  }
  // Starts a run when one is due, or sets the timer for the next check. It
  // does nothing offline or before the first-run screen is done.
  sync.startIfDue()
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Edikte',
    icon: devIcon,
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
 * Stops sign-ins, the sync, address lookups, analyses and downloads, waits a
 * few seconds for them to stop writing, then closes the database. Queued
 * analyses stay queued.
 */
async function stopServices(db: AppDatabase, running: Services | null): Promise<void> {
  if (running !== null) {
    running.providers.dispose()
    const stopping = Promise.allSettled([
      running.sync.dispose(),
      running.geocode.dispose(),
      running.analysis.shutdown(),
    ])
    // In the same tick, after analysis.shutdown() has begun: a job whose download
    // stops here keeps its row queued for the next start instead of failing.
    running.documents.shutdown()
    const stopped = stopping
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
