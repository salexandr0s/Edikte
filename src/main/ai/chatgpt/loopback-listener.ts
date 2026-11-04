import http from 'node:http'
import { ProviderError } from '../provider'
import { CALLBACK_PATH, constantTimeEqual, SIGN_IN_TIMEOUT_MS } from './authorization'
import { CALLBACK_PAGE_CSP, renderCallbackPage, type CallbackPageState } from './callback-page'

const MAX_HEADER_BYTES = 16384
const MAX_CONNECTIONS = 8
const CONNECTION_TIMEOUT_MS = 5000

export interface LoopbackListenerOptions {
  /** Only a callback carrying this state ends the wait. */
  state: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface LoopbackListener {
  readonly redirectUri: string
  /** The first callback URL with the right state; rejects on timeout or cancel. */
  readonly callback: Promise<URL>
  close(): void
}

export type StartLoopbackListener = (options: LoopbackListenerOptions) => Promise<LoopbackListener>

interface Verdict {
  status: number
  page: CallbackPageState | null
  text: string
  url: URL | null
}

/** Receives the OAuth redirect on 127.0.0.1 with a random port. */
export const startLoopbackListener: StartLoopbackListener = async (options) => {
  const server = http.createServer({
    maxHeaderSize: MAX_HEADER_BYTES,
    requestTimeout: CONNECTION_TIMEOUT_MS,
    headersTimeout: CONNECTION_TIMEOUT_MS,
    connectionsCheckingInterval: 1000,
  })
  server.maxConnections = MAX_CONNECTIONS
  server.setTimeout(CONNECTION_TIMEOUT_MS, (socket) => socket.destroy())

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new ProviderError('chatgpt', 'internal', 'The sign-in listener has no port')
  }
  const port = address.port
  const origin = `http://127.0.0.1:${port}`

  const { promise, resolve, reject } = Promise.withResolvers<URL>()
  // The caller may still be opening the browser when this fails.
  promise.catch(() => undefined)
  let finished = false

  const finish = (outcome: { url: URL } | { error: ProviderError }): void => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    server.close()
    server.closeIdleConnections()
    if ('url' in outcome) resolve(outcome.url)
    else {
      server.closeAllConnections()
      reject(outcome.error)
    }
  }
  const onAbort = (): void =>
    finish({
      error: new ProviderError('chatgpt', 'cancelled', 'The ChatGPT sign-in was cancelled'),
    })
  const timer = setTimeout(
    () =>
      finish({ error: new ProviderError('chatgpt', 'timeout', 'The ChatGPT sign-in timed out') }),
    options.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
  )

  server.on('request', (request, response) => {
    const verdict = inspect(request, port, origin, options.state)
    send(response, verdict)
    if (verdict.url) finish({ url: verdict.url })
  })

  if (options.signal?.aborted) onAbort()
  else options.signal?.addEventListener('abort', onAbort, { once: true })

  return {
    redirectUri: `${origin}${CALLBACK_PATH}`,
    callback: promise,
    close: () =>
      finish({
        error: new ProviderError('chatgpt', 'cancelled', 'The ChatGPT sign-in was closed'),
      }),
  }
}

function inspect(
  request: http.IncomingMessage,
  port: number,
  origin: string,
  state: string,
): Verdict {
  if (request.method !== 'GET') return plain(405, 'Method not allowed')
  if (request.httpVersion !== '1.1') return plain(400, 'Bad request')
  const hosts = request.headersDistinct.host ?? []
  if (hosts.length !== 1 || hosts[0] !== `127.0.0.1:${port}`) return plain(400, 'Bad request')
  if (request.headers['transfer-encoding'] !== undefined) return plain(400, 'Bad request')
  const length = request.headers['content-length']
  if (length !== undefined && length !== '0') return plain(400, 'Bad request')
  const requestOrigin = request.headers.origin
  if (requestOrigin !== undefined && requestOrigin !== origin) return plain(400, 'Bad request')

  const target = request.url ?? ''
  if (!target.startsWith('/') || target.startsWith('//')) return plain(400, 'Bad request')
  let url: URL
  try {
    url = new URL(target, origin)
  } catch {
    return plain(400, 'Bad request')
  }
  if (url.pathname !== CALLBACK_PATH) return plain(404, 'Not found')

  const states = url.searchParams.getAll('state')
  const [received] = states
  if (states.length !== 1 || received === undefined || !constantTimeEqual(received, state)) {
    return { status: 400, page: 'unmatched', text: '', url: null }
  }
  const codes = url.searchParams.getAll('code')
  const completed = !url.searchParams.has('error') && codes.length === 1 && codes[0] !== ''
  return { status: 200, page: completed ? 'received' : 'not_completed', text: '', url }
}

function plain(status: number, text: string): Verdict {
  return { status, page: null, text, url: null }
}

function send(response: http.ServerResponse, verdict: Verdict): void {
  const body = verdict.page ? renderCallbackPage(verdict.page) : verdict.text
  response.writeHead(verdict.status, {
    'Content-Type': verdict.page ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': CALLBACK_PAGE_CSP,
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close',
    ...(verdict.status === 405 ? { Allow: 'GET' } : {}),
  })
  response.end(body)
}
