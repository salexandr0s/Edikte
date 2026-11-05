import type { ProviderId, ProviderState } from '@shared/providers'
import { ProviderError, type AnalysisProgressHandler, type ProviderDetection } from '../provider'

export type Fetch = typeof fetch

export function detection(
  id: ProviderId,
  state: ProviderState,
  now: number,
  extra: { accountLabel?: string | null; plan?: string | null; detail?: string | null } = {},
): ProviderDetection {
  return {
    id,
    state,
    version: null,
    binaryPath: null,
    binaryPathSource: null,
    accountLabel: extra.accountLabel ?? null,
    plan: extra.plan ?? null,
    detail: extra.detail ?? null,
    checkedAt: new Date(now).toISOString(),
  }
}

/** The account label for a key: an ellipsis and its last four characters. */
export function maskKey(key: string): string {
  return `…${key.slice(-4)}`
}

/** The caller's signal plus a time limit. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** Maps a thrown fetch or stream error without copying request data into the message. */
export function transportError(
  provider: ProviderId,
  error: unknown,
  callerSignal: AbortSignal | undefined,
  what: string,
): ProviderError {
  if (error instanceof ProviderError) return error
  if (callerSignal?.aborted)
    return new ProviderError(provider, 'cancelled', `${what} was cancelled`)
  if (errorName(error) === 'TimeoutError') {
    return new ProviderError(provider, 'timeout', `${what} timed out`)
  }
  const code = errorCode(error)
  return new ProviderError(provider, 'network', `${what} failed${code ? ` (${code})` : ''}`)
}

const NOT_SENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
])

/** True when no connection was opened, so the server cannot have seen the request. */
export function requestNeverSent(error: unknown): boolean {
  const code = errorCode(error)
  return code !== null && NOT_SENT_CODES.has(code)
}

/** The first string `code` along the cause chain; undici wraps socket errors in `cause`. */
export function errorCode(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if ('code' in current && typeof current.code === 'string') return current.code
    current = current.cause
  }
  return null
}

function errorName(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : null
}

export class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`Response body larger than ${limit} bytes`)
  }
}

/** The body as a byte stream; Node types it as a stream of `any`. */
export function bodyStream(response: Response): ReadableStream<Uint8Array> | null {
  return response.body as ReadableStream<Uint8Array> | null
}

export async function readBody(response: Response, maxBytes: number): Promise<string> {
  const body = bodyStream(response)
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(chunks).toString('utf8')
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new BodyTooLargeError(maxBytes)
    }
    chunks.push(value)
  }
}

/** Parses JSON; returns undefined for an empty or malformed body. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** An error code from a server body, kept only if it looks like an identifier. */
export function safeCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : null
}

/**
 * Streaming progress. Each delta is usually one token, so the delta count
 * serves as the output token estimate.
 */
export function createProgress(onProgress: AnalysisProgressHandler | undefined): {
  waiting: () => void
  delta: () => void
} {
  let deltas = 0
  return {
    waiting: () => onProgress?.({ phase: 'waiting' }),
    delta: () => {
      deltas += 1
      if (deltas === 1 || deltas % 20 === 0) {
        onProgress?.({ phase: 'streaming', outputTokens: deltas })
      }
    },
  }
}
