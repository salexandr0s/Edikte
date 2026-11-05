import { EDIKTE_HOST } from '@shared/edikte-codes'
import { AppError, isAppError, type AppErrorCode } from '@shared/errors'
import { siteUrl } from './site-text'

/** What the sync runner needs from an HTTP client; tests pass a fake. */
export interface PageSource {
  /** Fetches a page of the Edikte site and returns its text. */
  getText(url: string, signal?: AbortSignal): Promise<string>
  /** Requests sent so far, retries included. */
  readonly requestCount: number
}

export interface EdikteClientOptions {
  /** App version for the User-Agent. */
  appVersion: string
  /** Defaults to Node's global fetch; tests inject a fake. */
  fetch?: typeof globalThis.fetch
  /** Minimum time between the starts of two requests. */
  minIntervalMs?: number
  timeoutMs?: number
  /** Attempts per page, the first one included. */
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** A longer Retry-After ends the request instead of waiting that long. */
  maxRetryAfterMs?: number
  /** Response size cap; edict pages are 10 to 50 KB, a full state list under 1 MB. */
  maxBytes?: number
  /** Consecutive failed attempts after which requests pause. */
  breakerThreshold?: number
  breakerCooldownMs?: number
  /** Jitter source in [0, 1); tests pin it. */
  random?: () => number
}

type Settings = Required<Omit<EdikteClientOptions, 'appVersion' | 'fetch' | 'random'>>

export const CLIENT_DEFAULTS: Readonly<Settings> = {
  minIntervalMs: 1_000,
  timeoutMs: 30_000,
  maxAttempts: 4,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  maxRetryAfterMs: 120_000,
  maxBytes: 8 * 1024 * 1024,
  breakerThreshold: 5,
  breakerCooldownMs: 5 * 60_000,
}

export function userAgent(appVersion: string): string {
  return `Edikte/${appVersion} (desktop app for personal use)`
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 3

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(`HTTP ${status}`)
  }
}

interface AttemptFailure {
  error: AppError
  retryable: boolean
  /** Counts towards the circuit breaker. */
  countsAsFailure: boolean
  retryAfterMs: number | null
}

/**
 * Polite HTTP client for edikte.justiz.gv.at: one request at a time, at most
 * one per second, backoff with jitter on 403, 429 and 5xx (honouring
 * Retry-After), a pause after repeated failures, a size cap and UTF-8 decoding.
 * Every failure is an AppError: network, timeout, site_unavailable,
 * rate_limited, site_changed, not_found or cancelled.
 */
export class EdikteClient implements PageSource {
  readonly #settings: Settings
  readonly #fetch: typeof globalThis.fetch
  readonly #random: () => number
  readonly #userAgent: string
  #requestCount = 0
  #queue: Promise<unknown> = Promise.resolve()
  #nextSlotAt = 0
  #consecutiveFailures = 0
  #pausedUntil = 0
  /** Code of the failure that paused requests; paused requests fail with it. */
  #pauseCode: AppErrorCode = 'site_unavailable'

  constructor(options: EdikteClientOptions) {
    const { appVersion, fetch: fetchImpl, random, ...rest } = options
    const overrides = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    ) as Partial<Settings>
    this.#settings = { ...CLIENT_DEFAULTS, ...overrides }
    this.#fetch = fetchImpl ?? ((input, init) => fetch(input, init))
    this.#random = random ?? Math.random
    this.#userAgent = userAgent(appVersion)
  }

  get requestCount(): number {
    return this.#requestCount
  }

  getText(url: string, signal?: AbortSignal): Promise<string> {
    const target = siteUrl(url)
    if (target === null) {
      return Promise.reject(
        new AppError('site_changed', 'Refused a link that leaves edikte.justiz.gv.at'),
      )
    }
    // Calls queue up so requests never overlap, whoever makes them.
    const result = this.#queue.then(() => this.#getWithRetries(target, signal))
    this.#queue = result.catch(() => undefined)
    return result
  }

  /**
   * `fetch` in the same queue and at the same pace as page requests, for
   * document downloads. The next request waits until this response's body has
   * been read, cancelled or has failed, or the request's signal aborts. Not
   * counted in `requestCount`, which the sync summary reports.
   */
  readonly limitedFetch: typeof globalThis.fetch = (input, init) => {
    const signal = init?.signal ?? undefined
    let release = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const result = this.#queue.then(async () => {
      throwIfCancelled(signal)
      this.#ensureNotPaused()
      await this.#waitForSlot(signal)
      let response: Response
      try {
        response = await this.#fetch(input, init)
      } catch (error) {
        if (signal?.aborted !== true) this.#slowDown('network', null)
        throw error
      }
      const throttled = throttleCode(response.status)
      if (throttled !== null) {
        this.#slowDown(throttled, retryAfterMs(response.headers.get('retry-after')))
      } else if (response.ok) {
        this.#consecutiveFailures = 0
      }
      return holdUntilRead(response, release, signal)
    })
    result.catch(release)
    this.#queue = held
    return result
  }

  /**
   * Counts a failed download and moves the next request out by the backoff,
   * or by Retry-After when that is longer, up to `maxRetryAfterMs`.
   */
  #slowDown(code: AppErrorCode, retryAfter: number | null): void {
    this.#recordFailure(code)
    const wait = Math.max(this.#backoffMs(this.#consecutiveFailures), retryAfter ?? 0)
    this.#nextSlotAt = Math.max(
      this.#nextSlotAt,
      Date.now() + Math.min(wait, this.#settings.maxRetryAfterMs),
    )
  }

  async #getWithRetries(url: string, signal: AbortSignal | undefined): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      throwIfCancelled(signal)
      this.#ensureNotPaused()
      await this.#waitForSlot(signal)
      try {
        const text = await this.#attempt(url, signal)
        this.#consecutiveFailures = 0
        return text
      } catch (error) {
        const failure = classifyFailure(error)
        if (failure.countsAsFailure) this.#recordFailure(failure.error.code)
        const delay = failure.retryAfterMs ?? this.#backoffMs(attempt)
        if (
          !failure.retryable ||
          attempt >= this.#settings.maxAttempts ||
          delay > this.#settings.maxRetryAfterMs
        ) {
          throw failure.error
        }
        await sleep(delay, signal)
      }
    }
  }

  async #attempt(url: string, signal: AbortSignal | undefined): Promise<string> {
    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort()
    signal?.addEventListener('abort', forwardAbort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.#settings.timeoutMs)
    try {
      // Redirects are followed by hand, so no request leaves the site or drops https.
      for (let target = url, hop = 0; ; hop += 1) {
        if (hop > 0) await this.#waitForSlot(controller.signal)
        this.#requestCount += 1
        const response = await this.#fetch(target, {
          method: 'GET',
          headers: {
            'User-Agent': this.#userAgent,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'de-AT,de;q=0.9',
          },
          redirect: 'manual',
          signal: controller.signal,
        })
        if (response.url !== '' && new URL(response.url).host !== EDIKTE_HOST) {
          await cancelBody(response)
          throw new AppError('site_changed', 'The site redirected to another host')
        }
        if (REDIRECT_STATUSES.has(response.status)) {
          await cancelBody(response)
          if (hop >= MAX_REDIRECTS) {
            throw new AppError('site_changed', 'The site redirected too many times')
          }
          target = redirectTarget(response, target)
          continue
        }
        if (!response.ok) {
          await cancelBody(response)
          throw new HttpStatusError(
            response.status,
            retryAfterMs(response.headers.get('retry-after')),
          )
        }
        const contentType = response.headers.get('content-type')
        if (contentType !== null && !/html|text\//i.test(contentType)) {
          await cancelBody(response)
          throw new AppError('site_changed', `Unexpected content type ${contentType}`)
        }
        return await readBody(response, this.#settings.maxBytes)
      }
    } catch (error) {
      if (signal?.aborted === true) throw cancelledError()
      if (timedOut) {
        throw new AppError('timeout', `No answer within ${this.#settings.timeoutMs / 1000} s`)
      }
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }

  async #waitForSlot(signal: AbortSignal | undefined): Promise<void> {
    const wait = this.#nextSlotAt - Date.now()
    if (wait > 0) await sleep(wait, signal)
    this.#nextSlotAt = Date.now() + this.#settings.minIntervalMs
  }

  #ensureNotPaused(): void {
    if (
      this.#consecutiveFailures >= this.#settings.breakerThreshold &&
      Date.now() < this.#pausedUntil
    ) {
      throw new AppError(this.#pauseCode, 'Requests paused after repeated failures')
    }
  }

  /** `code` is what paused requests fail with: network or timeout when the site never answered. */
  #recordFailure(code: AppErrorCode): void {
    this.#consecutiveFailures += 1
    // After the cooldown one probe goes through; another failure pauses again.
    if (this.#consecutiveFailures >= this.#settings.breakerThreshold) {
      this.#pausedUntil = Date.now() + this.#settings.breakerCooldownMs
      this.#pauseCode = code
    }
  }

  #backoffMs(attempt: number): number {
    const { baseDelayMs, maxDelayMs, minIntervalMs } = this.#settings
    const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
    return Math.max(minIntervalMs, Math.round(capped * (0.75 + this.#random() * 0.5)))
  }
}

function classifyFailure(error: unknown): AttemptFailure {
  if (error instanceof HttpStatusError) {
    const { status, retryAfterMs } = error
    const throttled = throttleCode(status)
    if (throttled !== null) {
      return {
        error: new AppError(throttled, `HTTP ${status} from the site`),
        retryable: true,
        countsAsFailure: true,
        retryAfterMs,
      }
    }
    const code = status === 404 || status === 410 ? 'not_found' : 'site_changed'
    return {
      error: new AppError(code, `HTTP ${status} from the site`),
      retryable: false,
      countsAsFailure: false,
      retryAfterMs: null,
    }
  }
  if (isAppError(error)) {
    const timeout = error.code === 'timeout'
    return { error, retryable: timeout, countsAsFailure: timeout, retryAfterMs: null }
  }
  return {
    error: new AppError('network', 'Could not reach edikte.justiz.gv.at', { cause: error }),
    retryable: true,
    countsAsFailure: true,
    retryAfterMs: null,
  }
}

/** Code for a status that calls for backing off; null for any other status. */
function throttleCode(status: number): AppErrorCode | null {
  if (status === 403 || status === 429) return 'rate_limited'
  return status >= 500 ? 'site_unavailable' : null
}

/** Where a redirect leads; only https pages of the Edikte site are followed. */
function redirectTarget(response: Response, from: string): string {
  const location = response.headers.get('location')
  let next: URL | null = null
  try {
    next = location === null ? null : new URL(location, from)
  } catch {
    next = null
  }
  if (next?.protocol !== 'https:' || next.host !== EDIKTE_HOST) {
    throw new AppError('site_changed', 'The site redirected away from its https pages')
  }
  return next.toString()
}

/** Retry-After in seconds or as an HTTP date. */
function retryAfterMs(header: string | null): number | null {
  if (header === null) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelBody(response)
    throw tooLarge(maxBytes)
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    // Node types the body stream as any, so each chunk is checked.
    const chunk: { done: boolean; value?: unknown } = await reader.read()
    if (chunk.done) break
    if (!(chunk.value instanceof Uint8Array)) {
      throw new AppError('site_changed', 'Response body is not binary data')
    }
    size += chunk.value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge(maxBytes)
    }
    chunks.push(chunk.value)
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks))
}

function tooLarge(maxBytes: number): AppError {
  return new AppError('site_changed', `Response larger than ${Math.round(maxBytes / 1024)} KB`)
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

/**
 * The response with a body that calls `release` once it has been read to the
 * end, cancelled or has failed, or once the signal aborts.
 */
function holdUntilRead(
  response: Response,
  release: () => void,
  signal: AbortSignal | undefined,
): Response {
  let released = false
  const finish = (): void => {
    if (released) return
    released = true
    signal?.removeEventListener('abort', finish)
    release()
  }
  const source = response.body
  // A listener added to a signal that has already aborted would never run.
  if (source === null || signal?.aborted === true) finish()
  else signal?.addEventListener('abort', finish, { once: true })
  if (source === null) return response
  const reader = source.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Node types the body stream as any, so each chunk is checked.
        const chunk: { done: boolean; value?: unknown } = await reader.read()
        if (chunk.done) {
          finish()
          controller.close()
        } else if (chunk.value instanceof Uint8Array) {
          controller.enqueue(chunk.value)
        } else {
          finish()
          controller.error(new AppError('site_changed', 'Response body is not binary data'))
        }
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    cancel(reason: unknown) {
      finish()
      return reader.cancel(reason)
    },
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function cancelledError(): AppError {
  return new AppError('cancelled', 'Cancelled')
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw cancelledError()
}

/** Waits, failing with `cancelled` as soon as the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(cancelledError())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(cancelledError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
