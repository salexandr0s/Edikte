import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { EDICT_ID_PATTERN } from '@shared/edict-id'
import { AppError } from '@shared/errors'
import { safePdfFileName } from './file-names'
import { DEFAULT_MAX_DOCUMENT_BYTES } from './limits'
import { parseDownloadUrl, parseRedirectUrl } from './url-policy'

// Download logic ported from immoradar's document-worker.ts (redirect host
// check, timeout, streamed size cap), writing to disk instead of memory.

/** A download fails when the site sends nothing for this long. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000
/** Upper bound for a whole download, however steadily the bytes arrive. */
export const DEFAULT_MAX_DURATION_MS = 30 * 60_000
/** How long a failed download waits for its temporary file to close before removing it. */
const CLOSE_WAIT_MS = 2_000
const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const PROGRESS_STEP_BYTES = 256 * 1024
/** Readers accept "%PDF-" after a little leading garbage, so look a bit further than byte 0. */
const PDF_HEADER_WINDOW = 1024
const DEFAULT_USER_AGENT = 'Edikte desktop app (private use)'

export interface DownloadProgress {
  bytesDone: number
  /** From Content-Length; null when the site does not send it. */
  bytesTotal: number | null
}

export interface DownloadOptions {
  url: string
  edictId: string
  /** Name as published; it is sanitised and gets a ".pdf" ending. */
  fileName: string
  /** The app's documents folder (AppPaths.documents). */
  documentsDir: string
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
  /** The scraper client's rate-limited fetch, so downloads keep the site's pace. */
  fetch: typeof fetch
  maxBytes?: number
  /** Fails the download when no data arrives for this long. */
  idleTimeoutMs?: number
  /** Fails the download when it takes longer than this overall. */
  maxDurationMs?: number
  userAgent?: string
}

export interface DownloadedFile {
  /** documents.localPath: `<edictId>/<file name>`, relative to the documents folder. */
  localPath: string
  absolutePath: string
  bytes: number
  sha256: string
  /** Address after redirects. */
  finalUrl: string
}

/**
 * Downloads a PDF of an edict to `<documents>/<edictId>/<file>`. The file
 * comes from edikte.justiz.gv.at for a court auction and from
 * justizonline.gv.at for a sale in insolvency proceedings. The first URL must
 * fit the edict, and every redirect hop must stay under the document path of
 * the same host. The body is streamed to a temporary file with a size cap and
 * a running SHA-256, then renamed into place, so a failed or cancelled
 * download never leaves a partial file.
 */
export async function downloadDocument(options: DownloadOptions): Promise<DownloadedFile> {
  if (!EDICT_ID_PATTERN.test(options.edictId)) {
    throw new AppError('invalid_request', 'Invalid edict ID')
  }
  const startUrl = parseDownloadUrl(options.url, options.edictId)
  if (startUrl === null) {
    throw new AppError(
      'forbidden',
      'Documents of this edict cannot be downloaded from this address',
    )
  }
  const fileName = safePdfFileName(options.fileName)
  const folder = path.join(path.resolve(options.documentsDir), options.edictId)
  const target = path.join(folder, fileName)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DOCUMENT_BYTES
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  const overall = AbortSignal.timeout(maxDurationMs)
  const idle = idleTimer(idleTimeoutMs)
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    overall,
    idle.signal,
  ])

  try {
    signal.throwIfAborted()
    const { response, url } = await fetchFollowingRedirects(startUrl, options, signal, idle)
    await rejectFailedResponse(response)
    const bytesTotal = declaredLength(response)
    if (bytesTotal !== null && bytesTotal > maxBytes) {
      await response.body?.cancel()
      throw tooLarge(maxBytes)
    }
    const written = await writeBody(response, {
      folder,
      target,
      signal,
      maxBytes,
      bytesTotal,
      onProgress: options.onProgress,
      onData: idle.reset,
    })
    return {
      localPath: `${options.edictId}/${fileName}`,
      absolutePath: target,
      bytes: written.bytes,
      sha256: written.sha256,
      finalUrl: url.toString(),
    }
  } catch (error) {
    if (options.signal?.aborted) throw new AppError('cancelled', 'Download cancelled')
    if (idle.signal.aborted) {
      throw new AppError('timeout', `The site sent no data for ${seconds(idleTimeoutMs)} s`)
    }
    if (overall.aborted) {
      throw new AppError('timeout', `Download took longer than ${seconds(maxDurationMs)} s`)
    }
    if (error instanceof AppError) throw error
    throw new AppError('network', 'The document could not be downloaded', { cause: error })
  } finally {
    idle.stop()
  }
}

/**
 * A signal that aborts once `reset` has not been called for `ms`. It starts
 * unarmed: the first `reset` arms it, and `pause` disarms it while a request
 * waits in the client's queue, which has its own header timeout.
 */
function idleTimer(ms: number): IdleTimer {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  let stopped = false
  const stop = (): void => {
    stopped = true
    clearTimeout(timer)
  }
  const reset = (): void => {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), ms)
  }
  return { signal: controller.signal, reset, pause: () => clearTimeout(timer), stop }
}

interface IdleTimer {
  signal: AbortSignal
  reset: () => void
  pause: () => void
  stop: () => void
}

function seconds(ms: number): number {
  return Math.round(ms / 1000)
}

async function fetchFollowingRedirects(
  start: URL,
  options: DownloadOptions,
  signal: AbortSignal,
  idle: Pick<IdleTimer, 'reset' | 'pause'>,
): Promise<{ response: Response; url: URL }> {
  const fetchImpl = options.fetch
  let url = start
  for (let hop = 0; ; hop += 1) {
    idle.pause()
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: 'application/pdf,*/*;q=0.5',
      },
    })
    idle.reset()
    if (!REDIRECT_STATUSES.has(response.status)) return { response, url }
    await response.body?.cancel()
    if (hop >= MAX_REDIRECTS) throw new AppError('network', 'Too many redirects')
    const location = response.headers.get('location')
    let next: URL | null = null
    try {
      next = location === null ? null : new URL(location, url)
    } catch {
      next = null
    }
    if (next === null) throw new AppError('network', 'Redirect without a valid address')
    const allowed = parseRedirectUrl(next.toString(), url)
    if (allowed === null) {
      throw new AppError(
        'forbidden',
        `The download was redirected away from the documents on ${url.hostname}`,
      )
    }
    url = allowed
  }
}

async function rejectFailedResponse(response: Response): Promise<void> {
  if (response.ok) return
  await response.body?.cancel()
  const status = response.status
  const detail = `The site answered with HTTP ${status}`
  if (status === 404 || status === 410) throw new AppError('not_found', detail)
  if (status === 429) throw new AppError('rate_limited', detail)
  if (status === 403 || status >= 500) throw new AppError('site_unavailable', detail)
  throw new AppError('network', detail)
}

function declaredLength(response: Response): number | null {
  const header = response.headers.get('content-length')
  if (header === null || !/^\d+$/.test(header.trim())) return null
  return Number(header.trim())
}

function tooLarge(maxBytes: number): AppError {
  const megabytes = Math.round(maxBytes / (1024 * 1024))
  return new AppError('document_too_large', `The document is larger than ${megabytes} MB`)
}

interface WriteContext {
  folder: string
  target: string
  signal: AbortSignal
  maxBytes: number
  bytesTotal: number | null
  onProgress: ((progress: DownloadProgress) => void) | undefined
  /** Called for every chunk received. */
  onData: () => void
}

async function writeBody(
  response: Response,
  context: WriteContext,
): Promise<{ bytes: number; sha256: string }> {
  if (response.body === null) throw new AppError('network', 'The site sent an empty response')
  await storage(() => mkdir(context.folder, { recursive: true, mode: 0o700 }))

  const temp = path.join(context.folder, `.${randomBytes(8).toString('hex')}.part`)
  const hash = createHash('sha256')
  let bytes = 0
  let reported = 0
  let header = Buffer.alloc(0)

  const meter = new Transform({
    transform(chunk: Uint8Array, _encoding, callback) {
      context.onData()
      bytes += chunk.byteLength
      if (bytes > context.maxBytes) {
        callback(tooLarge(context.maxBytes))
        return
      }
      if (header.length < PDF_HEADER_WINDOW) {
        header = Buffer.concat([header, chunk.subarray(0, PDF_HEADER_WINDOW - header.length)])
      }
      hash.update(chunk)
      if (context.onProgress && bytes - reported >= PROGRESS_STEP_BYTES) {
        reported = bytes
        context.onProgress({ bytesDone: bytes, bytesTotal: context.bytesTotal })
      }
      callback(null, chunk)
    },
  })
  let file: WriteStream | undefined

  try {
    file = createWriteStream(temp, { flags: 'wx', mode: 0o600, flush: true })
    await pipeline(Readable.fromWeb(response.body), meter, file, { signal: context.signal })
    if (!header.includes('%PDF-')) {
      throw new AppError('document_unreadable', 'The downloaded file is not a PDF')
    }
    await storage(() => rename(temp, context.target))
  } catch (error) {
    // The stream may still be opening the file: removing it before the handle
    // closes could leave it behind. What stays anyway, retention removes.
    if (file !== undefined) await closed(file)
    await rm(temp, { force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined)
    // pipeline tears every stream down with the first error, so the file
    // stream also sees size-cap and network errors. Only a file system error,
    // which carries a syscall, means the folder cannot be written.
    if (isFileSystemError(error) && !context.signal.aborted) throw storageUnavailable(error)
    throw error
  }
  context.onProgress?.({ bytesDone: bytes, bytesTotal: context.bytesTotal ?? bytes })
  return { bytes, sha256: hash.digest('hex') }
}

/** Waits until a file stream has closed its handle, for at most CLOSE_WAIT_MS. */
async function closed(stream: WriteStream): Promise<void> {
  if (stream.closed) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, CLOSE_WAIT_MS)
    stream.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function storage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw storageUnavailable(error)
  }
}

function isFileSystemError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'syscall' in error
}

function storageUnavailable(cause: unknown): AppError {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
      ? ` (${cause.code})`
      : ''
  return new AppError('storage_unavailable', `The documents folder cannot be written${code}`, {
    cause,
  })
}
