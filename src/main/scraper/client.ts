import { EDIKTE_HOST, JUSTIZONLINE_API_PATH, JUSTIZONLINE_HOST } from '@shared/edikte-codes'
import { AppError, isAppError, type AppErrorCode } from '@shared/errors'
import { siteUrl } from './site-text'

/** What the sync runner needs from an HTTP client; tests pass a fake. */
export interface PageSource {
  /** Fetches a page of the Edikte site and returns its text. */
  getText(url: string, signal?: AbortSignal): Promise<string>
  /** Requests sent so far, retries included. */
  readonly requestCount: number
}

/** What the reader of the JustizOnline API needs from an HTTP client; tests can pass a fake. */
export interface JsonSource {
  /** Fetches an address of the JustizOnline Ediktsdatei API and returns the parsed JSON. */
  getJson(url: string, signal?: AbortSignal): Promise<unknown>
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
  /**
   * Time limit for one attempt at a page of edikte.justiz.gv.at, and for the
   * response headers of a download from it.
   */
  timeoutMs?: number
  /**
   * The same limit for justizonline.gv.at. It is shorter because about one
   * request in seven gets no answer there, and a retry answers at once.
   */
  apiTimeoutMs?: number
  /** Attempts per page or API request, the first one included. */
  maxAttempts?: number
  /** Tries per download, the first one included. Only a try without an answer is repeated. */
  downloadAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** A longer Retry-After ends the request instead of waiting that long. */
  maxRetryAfterMs?: number
  /** Response size cap; edict pages are 10 to 50 KB, a full state list under 1 MB. */
  maxBytes?: number
  /** Consecutive failed attempts on one host after which requests to it pause. */
  breakerThreshold?: number
  breakerCooldownMs?: number
  /** Jitter source in [0, 1); tests pin it. */
  random?: () => number
}

type Settings = Required<Omit<EdikteClientOptions, 'appVersion' | 'fetch' | 'random'>>

const CLIENT_DEFAULTS: Readonly<Settings> = {
  minIntervalMs: 1_000,
  timeoutMs: 30_000,
  apiTimeoutMs: 10_000,
  maxAttempts: 4,
  downloadAttempts: 3,
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

/** How the client treats one host. */
interface HostProfile {
  /** Host name; requests go to its default https port. */
  readonly host: string
  /** Name of the site in error messages. */
  readonly siteName: string
  /** What an answer has to be. */
  readonly kind: 'html' | 'json'
  /** Request headers besides the User-Agent. */
  readonly headers: Readonly<Record<string, string>>
  /** The setting that holds the host's timeout. */
  readonly timeout: 'timeoutMs' | 'apiTimeoutMs'
  /** Requests and redirects stay below this path; "/" is the whole host. */
  readonly pathPrefix: string
}

/** The Domino site with the court auctions, read as HTML pages. */
const DOMINO_SITE: HostProfile = {
  host: EDIKTE_HOST,
  siteName: EDIKTE_HOST,
  kind: 'html',
  headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'de-AT,de;q=0.9' },
  timeout: 'timeoutMs',
  pathPrefix: '/',
}

/** The JustizOnline API with the sales in insolvency proceedings, read as JSON. */
const JUSTIZONLINE_API: HostProfile = {
  host: JUSTIZONLINE_HOST,
  siteName: 'the JustizOnline API',
  kind: 'json',
  headers: { Accept: 'application/json' },
  timeout: 'apiTimeoutMs',
  pathPrefix: JUSTIZONLINE_API_PATH,
}

const HOST_PROFILES: readonly HostProfile[] = [DOMINO_SITE, JUSTIZONLINE_API]

/** Failure state of one host. */
interface HostHealth {
  consecutiveFailures: number
  pausedUntil: number
  /** Code of the failure that paused requests; paused requests fail with it. */
  pauseCode: AppErrorCode
}

type FetchInput = Parameters<typeof globalThis.fetch>[0]
type FetchInit = Parameters<typeof globalThis.fetch>[1]

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
 * Polite HTTP client for the two sites the app reads: the HTML pages of
 * edikte.justiz.gv.at and the JSON API of justizonline.gv.at. Both share one
 * queue and one pace: one request at a time, at most one per second in total.
 * Each host has a profile (what it answers with, its Accept header, its
 * timeout), and both get backoff with jitter on 403, 429 and 5xx (honouring
 * Retry-After), a size cap and UTF-8 decoding. Failures are counted per host,
 * so a pause after repeated failures of one site does not stop requests to
 * the other. A backoff wait still happens inside the shared queue and delays
 * whatever is queued behind it. Every failure is an AppError: network,
 * timeout, site_unavailable, rate_limited, site_changed, not_found or
 * cancelled.
 */
export class EdikteClient implements PageSource, JsonSource {
  readonly #settings: Settings
  readonly #fetch: typeof globalThis.fetch
  readonly #random: () => number
  readonly #userAgent: string
  #requestCount = 0
  #queue: Promise<unknown> = Promise.resolve()
  #nextSlotAt = 0
  /** Failure state by host name, created with the first request to a host. */
  readonly #health = new Map<string, HostHealth>()

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

  /** Page and API requests together, retries included. Downloads are not counted. */
  get requestCount(): number {
    return this.#requestCount
  }

  getText(url: string, signal?: AbortSignal): Promise<string> {
    const target = siteUrl(url)
    if (target === null) return Promise.reject(refusedAddress(DOMINO_SITE))
    return this.#enqueue(DOMINO_SITE, target, signal)
  }

  /**
   * Fetches an https address below the API path of justizonline.gv.at and
   * parses the answer. Any other address is refused before a request is sent.
   */
  getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const target = allowedUrl(JUSTIZONLINE_API, url)
    if (target === null) return Promise.reject(refusedAddress(JUSTIZONLINE_API))
    return this.#enqueue(JUSTIZONLINE_API, target.toString(), signal).then(parseJson)
  }

  /**
   * `fetch` in the same queue and at the same pace as page requests, for
   * document downloads with GET. Failures count against the host of the
   * address. A try that gets no response headers within that host's timeout
   * is repeated after the backoff, up to `downloadAttempts` tries in all.
   * Nothing of the body has been read by then, so a repeated try cannot
   * deliver data twice. The next request waits until this response's body has
   * been read, cancelled or has failed, or the request's signal aborts. Not
   * counted in `requestCount`, which the sync summary reports.
   */
  readonly limitedFetch: typeof globalThis.fetch = (input, init) => {
    const signal = init?.signal ?? undefined
    const host = hostOf(input)
    const health = this.#healthOf(host)
    const timeoutMs = this.#downloadTimeoutMs(host)
    let release = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const result = this.#queue.then(async () => {
      for (let attempt = 1; ; attempt += 1) {
        throwIfCancelled(signal)
        this.#ensureNotPaused(health)
        // After a try without an answer, this wait covers the backoff the failure set.
        await this.#waitForSlot(signal)
        const response = await this.#tryDownload(input, init, health, timeoutMs)
        if (response !== null) return holdUntilRead(response, release, signal)
        if (attempt >= this.#settings.downloadAttempts) {
          throw new AppError('timeout', `No answer within ${timeoutMs / 1000} s`)
        }
      }
    })
    result.catch(release)
    this.#queue = held
    return result
  }

  /**
   * One try of a download. Returns null when no response headers arrived
   * within `timeoutMs`, which is the one failure the caller may repeat. A
   * failure counts against `health` and moves the next request out.
   */
  async #tryDownload(
    input: FetchInput,
    init: FetchInit,
    health: HostHealth,
    timeoutMs: number,
  ): Promise<Response | null> {
    const signal = init?.signal ?? undefined
    // The header timeout starts here, once the request has left the queue.
    const answer = new AbortController()
    const timer = setTimeout(() => answer.abort(), timeoutMs)
    let response: Response
    try {
      response = await this.#fetch(input, {
        ...init,
        signal: signal ? AbortSignal.any([signal, answer.signal]) : answer.signal,
      })
    } catch (error) {
      if (signal?.aborted === true) throw error
      this.#slowDown(health, answer.signal.aborted ? 'timeout' : 'network', null)
      if (answer.signal.aborted) return null
      throw error
    } finally {
      clearTimeout(timer)
    }
    const throttled = throttleCode(response.status)
    if (throttled !== null) {
      this.#slowDown(health, throttled, retryAfterMs(response.headers.get('retry-after')))
    } else if (response.ok) {
      health.consecutiveFailures = 0
    }
    return response
  }

  /** Header timeout of a download: its host's, or `timeoutMs` for a host without a profile. */
  #downloadTimeoutMs(host: string): number {
    const profile = HOST_PROFILES.find((candidate) => candidate.host === host)
    return this.#settings[profile?.timeout ?? 'timeoutMs']
  }

  #healthOf(host: string): HostHealth {
    let health = this.#health.get(host)
    if (health === undefined) {
      health = { consecutiveFailures: 0, pausedUntil: 0, pauseCode: 'site_unavailable' }
      this.#health.set(host, health)
    }
    return health
  }

  /**
   * Counts a failed download against its host and moves the next request out
   * by the backoff, or by Retry-After when that is longer, up to
   * `maxRetryAfterMs`. The pace is shared, so the next request waits that long
   * even when it goes to the other host.
   */
  #slowDown(health: HostHealth, code: AppErrorCode, retryAfter: number | null): void {
    this.#recordFailure(health, code)
    const wait = Math.max(this.#backoffMs(health.consecutiveFailures), retryAfter ?? 0)
    this.#nextSlotAt = Math.max(
      this.#nextSlotAt,
      Date.now() + Math.min(wait, this.#settings.maxRetryAfterMs),
    )
  }

  /**
   * Queues a request to an address that passed its profile's check. Calls
   * queue up so requests never overlap, whoever makes them and whichever host
   * they go to.
   */
  #enqueue(profile: HostProfile, url: string, signal: AbortSignal | undefined): Promise<string> {
    const result = this.#queue.then(() => this.#getWithRetries(profile, url, signal))
    this.#queue = result.catch(() => undefined)
    return result
  }

  async #getWithRetries(
    profile: HostProfile,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const health = this.#healthOf(profile.host)
    for (let attempt = 1; ; attempt += 1) {
      throwIfCancelled(signal)
      this.#ensureNotPaused(health)
      await this.#waitForSlot(signal)
      try {
        const text = await this.#attempt(profile, url, signal)
        health.consecutiveFailures = 0
        return text
      } catch (error) {
        const failure = classifyFailure(error, profile.siteName)
        if (failure.countsAsFailure) this.#recordFailure(health, failure.error.code)
        const delay = failure.retryAfterMs ?? this.#backoffMs(attempt)
        if (
          !failure.retryable ||
          attempt >= this.#settings.maxAttempts ||
          delay > this.#settings.maxRetryAfterMs
        ) {
          throw failure.error
        }
        // The wait is spent inside the queue, so requests queued behind this
        // one wait as well, those to the other host included.
        await sleep(delay, signal)
      }
    }
  }

  async #attempt(
    profile: HostProfile,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const timeoutMs = this.#settings[profile.timeout]
    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort()
    signal?.addEventListener('abort', forwardAbort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      // Redirects are followed by hand, so no request leaves the host, drops
      // https or goes outside the path its profile names.
      for (let target = url, hop = 0; ; hop += 1) {
        if (hop > 0) await this.#waitForSlot(controller.signal)
        this.#requestCount += 1
        const response = await this.#fetch(target, {
          method: 'GET',
          headers: { 'User-Agent': this.#userAgent, ...profile.headers },
          redirect: 'manual',
          signal: controller.signal,
        })
        // Only a fetch that followed a redirect itself can answer from another host.
        if (response.url !== '' && new URL(response.url).host !== profile.host) {
          await cancelBody(response)
          throw new AppError('site_changed', 'The site redirected to another host')
        }
        if (REDIRECT_STATUSES.has(response.status)) {
          await cancelBody(response)
          if (hop >= MAX_REDIRECTS) {
            throw new AppError('site_changed', 'The site redirected too many times')
          }
          target = redirectTarget(profile, response, target)
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
        if (!isExpectedContentType(profile.kind, contentType)) {
          await cancelBody(response)
          throw new AppError('site_changed', `Unexpected content type ${contentType ?? 'none'}`)
        }
        return await readBody(response, this.#settings.maxBytes)
      }
    } catch (error) {
      if (signal?.aborted === true) throw cancelledError()
      if (timedOut) {
        throw new AppError('timeout', `No answer within ${timeoutMs / 1000} s`)
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

  #ensureNotPaused(health: HostHealth): void {
    if (
      health.consecutiveFailures >= this.#settings.breakerThreshold &&
      Date.now() < health.pausedUntil
    ) {
      throw new AppError(health.pauseCode, 'Requests paused after repeated failures')
    }
  }

  /** `code` is what paused requests fail with: network or timeout when the site never answered. */
  #recordFailure(health: HostHealth, code: AppErrorCode): void {
    health.consecutiveFailures += 1
    // After the cooldown one probe goes through; another failure pauses again.
    if (health.consecutiveFailures >= this.#settings.breakerThreshold) {
      health.pausedUntil = Date.now() + this.#settings.breakerCooldownMs
      health.pauseCode = code
    }
  }

  #backoffMs(attempt: number): number {
    const { baseDelayMs, maxDelayMs, minIntervalMs } = this.#settings
    const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
    return Math.max(minIntervalMs, Math.round(capped * (0.75 + this.#random() * 0.5)))
  }
}

function classifyFailure(error: unknown, siteName: string): AttemptFailure {
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
    error: new AppError('network', `Could not reach ${siteName}`, { cause: error }),
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

/**
 * The address as a URL when the profile allows it: https, the profile's host
 * on its default port, no credentials and a path below the profile's. Null
 * otherwise. The URL parser resolves ".." first, so a path cannot climb out.
 */
function allowedUrl(profile: HostProfile, address: string, base?: string): URL | null {
  let url: URL
  try {
    url = new URL(address, base)
  } catch {
    return null
  }
  const allowed =
    url.protocol === 'https:' &&
    // `host` carries the port unless it is the default one.
    url.host === profile.host &&
    url.username === '' &&
    url.password === '' &&
    url.pathname.startsWith(profile.pathPrefix)
  return allowed ? url : null
}

function refusedAddress(profile: HostProfile): AppError {
  return new AppError('site_changed', `Refused a link that leaves ${profile.siteName}`)
}

/** Where a redirect leads; only addresses the profile allows are followed. */
function redirectTarget(profile: HostProfile, response: Response, from: string): string {
  const location = response.headers.get('location')
  const next = location === null ? null : allowedUrl(profile, location, from)
  if (next === null) {
    throw new AppError('site_changed', 'The site redirected away from its https pages')
  }
  return next.toString()
}

/**
 * Whether a Content-Type header fits the kind. A page may come without one;
 * JSON has to be declared.
 */
function isExpectedContentType(kind: HostProfile['kind'], contentType: string | null): boolean {
  if (kind === 'json') {
    return (
      contentType !== null && /^\s*application\/(?:[\w.-]+\+)?json\s*(?:;|$)/i.test(contentType)
    )
  }
  return contentType === null || /html|text\//i.test(contentType)
}

/**
 * Parses the body of an API answer. The parser's own error quotes the body,
 * which can name people, so it is not passed on as the cause.
 */
function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    throw new AppError('site_changed', 'The answer is not valid JSON')
  }
}

/** Host of a fetch address. Empty when the address does not parse; fetch refuses it then. */
function hostOf(input: FetchInput): string {
  try {
    return new URL(input instanceof Request ? input.url : input).host
  } catch {
    return ''
  }
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
