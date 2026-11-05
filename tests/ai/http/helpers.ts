import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { CHATGPT_SCOPES } from '../../../src/main/ai/chatgpt/authorization'
import type { Jwks } from '../../../src/main/ai/chatgpt/id-token'
import {
  createSecretStore,
  type SecretEncryption,
  type SecretFiles,
  type SecretStore,
} from '../../../src/main/secure/secret-store'

export const CLIENT_ID = 'client-123'

/** Reversible stand-in for safeStorage. */
export function fakeEncryption(): SecretEncryption & { available: boolean } {
  const encryption = {
    available: true,
    isAvailable: () => encryption.available,
    encrypt: (plainText: string) => Buffer.from(`enc:${Buffer.from(plainText).toString('hex')}`),
    decrypt: (cipherText: Buffer) => {
      const text = cipherText.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('not encrypted by this fake')
      return Buffer.from(text.slice(4), 'hex').toString('utf8')
    },
  }
  return encryption
}

export function memoryFiles(): SecretFiles {
  const contents = new Map<string, Buffer>()
  return {
    read: (file) => Promise.resolve(contents.get(file) ?? null),
    writeNew: (file, data) => {
      if (contents.has(file)) return Promise.reject(new Error('exists'))
      contents.set(file, data)
      return Promise.resolve()
    },
    rename: (from, to) => {
      const data = contents.get(from)
      if (!data) return Promise.reject(new Error('missing'))
      contents.delete(from)
      contents.set(to, data)
      return Promise.resolve()
    },
    remove: (file) => {
      contents.delete(file)
      return Promise.resolve()
    },
  }
}

export function memorySecretStore(): SecretStore {
  return createSecretStore({
    file: '/data/secrets.json',
    encryption: fakeEncryption(),
    files: memoryFiles(),
  })
}

/** Saves a finished ChatGPT sign-in with plan access for user-1, unless told otherwise. */
export async function saveChatGptSignIn(
  secrets: SecretStore,
  options: { expiresAt: number; refreshDispatched?: boolean; subject?: string },
): Promise<void> {
  await secrets.update((all) => ({
    ...all,
    chatgpt: {
      hostId: 'urn:uuid:00000000-0000-4000-8000-000000000000',
      clientId: CLIENT_ID,
      loginHint: 'max@example.com',
      credentials: {
        tokens: {
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresAt: options.expiresAt,
          scopes: [...CHATGPT_SCOPES],
          earliestRefreshAt: null,
        },
        identity: { subject: options.subject ?? 'user-1', email: 'max@example.com', name: null },
      },
      pending: null,
      refreshDispatched: options.refreshDispatched ?? false,
    },
  }))
}

export interface RecordedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

export type Route = (request: RecordedRequest, init?: RequestInit) => Response | Promise<Response>

/** A fetch that answers from routes keyed by "METHOD url-without-query" and records requests. */
export function fakeFetch(routes: Record<string, Route>): {
  fetch: typeof fetch
  requests: RecordedRequest[]
} {
  const requests: RecordedRequest[] = []
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : '',
    }
    requests.push(request)
    const key = `${request.method} ${url.split('?')[0] ?? url}`
    const route = routes[key]
    if (!route) throw new Error(`No route for ${key}`)
    return await route(request, init)
  }
  return { fetch: fetchFn, requests }
}

export function only<T>(items: readonly T[]): T {
  const [item] = items
  if (items.length !== 1 || item === undefined) {
    throw new Error(`Expected exactly one item, got ${items.length}`)
  }
  return item
}

export function bodyOf(request: RecordedRequest): unknown {
  return JSON.parse(request.body) as unknown
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** A streamed response delivering `chunks` one by one. */
export function streamResponse(chunks: string[], contentType = 'text/event-stream'): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

/** Sends `chunks`, then nothing more until `signal` aborts, like a connection that stalls. */
export function stalledResponse(
  chunks: string[],
  signal: AbortSignal | null | undefined,
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true })
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** SSE frames with the event name set to each payload's type. */
export function sseFrames(events: Array<{ type: string } & Record<string, unknown>>): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

export function splitEvery(text: string, size: number): string[] {
  const parts: string[] = []
  for (let index = 0; index < text.length; index += size) {
    parts.push(text.slice(index, index + size))
  }
  return parts
}

export interface SigningKey {
  kid: string
  privateKey: KeyObject
  jwks: Jwks
}

export function createSigningKey(kid = 'key-1'): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  return {
    kid,
    privateKey,
    jwks: {
      keys: [{ kty: 'RSA', kid, use: 'sig', alg: 'RS256', n: String(jwk.n), e: String(jwk.e) }],
    },
  }
}

export function signIdToken(
  key: SigningKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const head = encode({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header })
  const payload = encode(claims)
  const signature = sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), key.privateKey)
  return `${head}.${payload}.${signature.toString('base64url')}`
}
