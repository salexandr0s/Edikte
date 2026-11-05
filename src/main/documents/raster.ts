import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { AppError } from '@shared/errors'
import { RASTER_CHANNELS, type RasterJob } from '@shared/raster-channels'
import {
  chooseRasterPages,
  DEFAULT_JPEG_QUALITY,
  DEFAULT_RASTER_SIDE,
  RasterCollector,
  type RasterResult,
} from './raster-protocol'

export const RASTER_TIMEOUT_MS = 120_000

export interface RasterPageLocation {
  /** Vite dev server address in development, otherwise null. */
  devServerUrl: string | null
  /** Built page: out/renderer/pdf-raster.html. */
  pageFile: string
  /** Built preload: out/preload/pdf-raster.cjs. */
  preloadFile: string
}

/**
 * Where the raster page and its preload live. Pass `import.meta.dirname` of the
 * built main file (out/main), as src/main/index.ts does for the app window.
 */
export function rasterPageLocation(
  mainDir: string,
  devServerUrl: string | null,
): RasterPageLocation {
  return {
    devServerUrl,
    pageFile: path.join(mainDir, '../renderer/pdf-raster.html'),
    preloadFile: path.join(mainDir, '../preload/pdf-raster.cjs'),
  }
}

export interface RasterOptions {
  pdf: Uint8Array
  /** 1-based pages; duplicates are dropped and at most 12 are rendered. */
  pages: readonly number[]
  location: RasterPageLocation
  maxSide?: number
  quality?: number
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Renders chosen pages to JPEG with pdf.js in a hidden, sandboxed window. The
 * window gets the PDF bytes through its own preload, sends one image per page
 * and is destroyed afterwards, also on failure, timeout or abort.
 */
export async function renderPdfPages(options: RasterOptions): Promise<RasterResult> {
  const pages = chooseRasterPages(options.pages)
  if (pages.length === 0) return { images: [], failedPages: [] }
  if (options.signal?.aborted) throw new AppError('cancelled', 'Rendering cancelled')

  const job: RasterJob = {
    pdf: options.pdf,
    pages,
    maxSide: options.maxSide ?? DEFAULT_RASTER_SIDE,
    quality: options.quality ?? DEFAULT_JPEG_QUALITY,
  }
  const collector = new RasterCollector(job)
  const pageUrl = rasterPageUrl(options.location)
  const window = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      preload: options.location.preloadFile,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Hidden windows are throttled by default, which would stall rendering.
      backgroundThrottling: false,
      spellcheck: false,
      devTools: false,
    },
  })
  const contents = window.webContents
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined

  try {
    return await new Promise<RasterResult>((resolve, reject) => {
      const fromPage = (event: IpcMainInvokeEvent): boolean => {
        const frame = event.senderFrame
        return frame !== null && frame === contents.mainFrame && samePage(frame.url, pageUrl)
      }
      let jobSent = false
      contents.ipc.handle(RASTER_CHANNELS.job, (event) => {
        if (!fromPage(event) || jobSent) throw new Error('Not allowed')
        jobSent = true
        return job
      })
      contents.ipc.handle(RASTER_CHANNELS.page, (event, payload: unknown) => {
        if (!fromPage(event)) throw new Error('Not allowed')
        try {
          collector.acceptPage(payload)
        } catch (error) {
          reject(error instanceof AppError ? error : new AppError('internal', 'Rendering failed'))
          throw new Error('Rejected')
        }
      })
      contents.ipc.handle(RASTER_CHANNELS.done, (event, payload: unknown) => {
        if (!fromPage(event)) throw new Error('Not allowed')
        try {
          resolve(collector.finish(payload))
        } catch (error) {
          reject(error instanceof AppError ? error : new AppError('internal', 'Rendering failed'))
        }
      })
      contents.on('render-process-gone', () => {
        reject(new AppError('internal', 'The PDF renderer stopped'))
      })
      contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame) reject(new AppError('internal', `The PDF renderer did not load (${code})`))
      })
      timer = setTimeout(() => {
        reject(new AppError('timeout', 'Rendering scanned pages took too long'))
      }, options.timeoutMs ?? RASTER_TIMEOUT_MS)
      onAbort = () => reject(new AppError('cancelled', 'Rendering cancelled'))
      options.signal?.addEventListener('abort', onAbort, { once: true })
      window.loadURL(pageUrl).catch(() => {
        reject(new AppError('internal', 'The PDF renderer did not load'))
      })
    })
  } finally {
    clearTimeout(timer)
    if (onAbort !== undefined) options.signal?.removeEventListener('abort', onAbort)
    if (!window.isDestroyed()) window.destroy()
  }
}

function rasterPageUrl(location: RasterPageLocation): string {
  if (location.devServerUrl !== null) {
    return new URL('pdf-raster.html', location.devServerUrl.replace(/\/?$/, '/')).toString()
  }
  return pathToFileURL(location.pageFile).toString()
}

function samePage(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual)
    const b = new URL(expected)
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname
  } catch {
    return false
  }
}
