import path from 'node:path'
import { app, BrowserWindow, nativeTheme, session } from 'electron'
import { openDatabase, type AppDatabase } from './db/client'
import { ensurePresetFilters } from './db/user-store'
import { createIpcRouter } from './ipc/handle'
import { registerIpcHandlers } from './ipc/register'
import { log } from './log'
import { resolveAppPaths } from './paths'
import {
  createRendererTrust,
  installAppGuards,
  installSessionGuards,
  isTrustedSender,
} from './security'
import { runSmokeCheck } from './smoke-check'
import { showStartupError } from './startup-error'

// Before anything reads app paths or safeStorage: both derive from the name.
app.setName('Edikte')
// Tests and the packaged-app smoke check point the app at a scratch folder.
const userDataOverride = process.env.EDIKTE_USER_DATA_DIR
if (userDataOverride) app.setPath('userData', userDataOverride)
const smokeTest = process.env.EDIKTE_SMOKE_TEST === '1'
app.enableSandbox()

const devServerUrl = app.isPackaged ? null : (process.env.ELECTRON_RENDERER_URL ?? null)
const rendererIndexFile = path.join(import.meta.dirname, '../renderer/index.html')
const preloadFile = path.join(import.meta.dirname, '../preload/index.cjs')
const trust = createRendererTrust({ devServerUrl, rendererIndexFile })

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null

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
  database = openDatabase(paths.database)
  ensurePresetFilters(database)

  const router = createIpcRouter((event) =>
    isTrustedSender(event, mainWindow?.webContents ?? null, trust),
  )
  registerIpcHandlers(router, { db: database, paths })

  mainWindow = createMainWindow()
  if (smokeTest) runSmokeCheck(mainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })
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

function fail(error: unknown): void {
  log.error('app', 'Startup failed', error)
  // The self-check reports through its exit code; a modal dialog would block it.
  if (!smokeTest && app.isReady()) showStartupError(error)
  app.exit(1)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  database?.$client.close()
  database = null
})
