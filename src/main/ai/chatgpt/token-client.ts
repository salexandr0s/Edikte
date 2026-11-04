import { z } from 'zod'
import { ProviderError } from '../provider'
import {
  BodyTooLargeError,
  parseJson,
  readBody,
  requestNeverSent,
  safeCode,
  transportError,
  withTimeout,
  type Fetch,
} from '../api/common'
import { CHATGPT_ENDPOINTS, CHATGPT_ISSUER, OPENAI_RESOURCE, splitScopes } from './authorization'
import { JwksSchema, type Jwks } from './id-token'

export const AUTH_REQUEST_TIMEOUT_MS = 30_000
const MAX_AUTH_BODY_BYTES = 256 * 1024
const MAX_SCOPES = 32
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/

const INVALID_GRANT_CODES = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
])

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  idToken: string | null
  /** Epoch milliseconds, counted from when the request was sent. */
  expiresAt: number
  scopes: string[]
  earliestRefreshAt: number | null
}

/**
 * - not_sent: no connection was opened, so the old tokens are untouched
 * - transport: the request may have arrived but no answer came back
 * - rejected: an error answer without a known code
 * - invalid_response: a success answer that breaks the token rules
 */
export type TokenFailure =
  | 'not_sent'
  | 'transport'
  | 'invalid_grant'
  | 'invalid_client'
  | 'too_early'
  | 'rate_limited'
  | 'unavailable'
  | 'rejected'
  | 'invalid_response'

export class TokenEndpointError extends Error {
  constructor(
    readonly failure: TokenFailure,
    message: string,
  ) {
    super(message)
  }
}

const DiscoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  revocation_endpoint: z.string(),
  jwks_uri: z.string(),
  code_challenge_methods_supported: z.array(z.string()),
  id_token_signing_alg_values_supported: z.array(z.string()),
})

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().min(1).max(3600),
  refresh_token: z.string().min(1).nullish(),
  id_token: z.string().min(1).nullish(),
  scope: z.string().nullish(),
  earliest_refresh_at: z.union([z.number(), z.string()]).nullish(),
})
type TokenResponse = z.infer<typeof TokenResponseSchema>

/** Fails when OpenAI's published endpoints no longer match the ones this app uses. */
export async function checkDiscovery(fetchFn: Fetch, signal: AbortSignal): Promise<void> {
  const parsed = DiscoverySchema.safeParse(
    await getJson(fetchFn, CHATGPT_ENDPOINTS.discovery, signal, 'ChatGPT sign-in discovery'),
  )
  const document = parsed.success ? parsed.data : null
  if (
    document === null ||
    document.issuer !== CHATGPT_ISSUER ||
    document.authorization_endpoint !== CHATGPT_ENDPOINTS.authorize ||
    document.token_endpoint !== CHATGPT_ENDPOINTS.token ||
    document.revocation_endpoint !== CHATGPT_ENDPOINTS.revoke ||
    document.jwks_uri !== CHATGPT_ENDPOINTS.jwks ||
    !document.code_challenge_methods_supported.includes('S256') ||
    !document.id_token_signing_alg_values_supported.includes('RS256')
  ) {
    throw new ProviderError(
      'chatgpt',
      'provider_unavailable',
      'The ChatGPT sign-in configuration does not match what this app expects',
    )
  }
}

export async function fetchJwks(fetchFn: Fetch, signal: AbortSignal): Promise<Jwks> {
  const parsed = JwksSchema.safeParse(
    await getJson(fetchFn, CHATGPT_ENDPOINTS.jwks, signal, 'ChatGPT signing keys'),
  )
  if (!parsed.success) {
    throw new ProviderError(
      'chatgpt',
      'provider_unavailable',
      'ChatGPT signing keys are unreadable',
    )
  }
  return parsed.data
}

export interface CodeExchange {
  clientId: string
  code: string
  verifier: string
  redirectUri: string
  /** Scopes from the callback, used when the token response leaves them out. */
  callbackScopes: string[] | null
}

export async function exchangeCode(
  fetchFn: Fetch,
  input: CodeExchange,
  now: () => number,
  signal: AbortSignal,
): Promise<TokenSet> {
  const sentAt = now()
  const payload = await requestTokens(
    fetchFn,
    {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      resource: OPENAI_RESOURCE,
    },
    withTimeout(signal, AUTH_REQUEST_TIMEOUT_MS),
  )
  return toTokenSet(payload, sentAt, { kind: 'code', scopes: input.callbackScopes })
}

export interface TokenRefresh {
  clientId: string
  refreshToken: string
  previousScopes: string[]
}

export async function refreshTokens(
  fetchFn: Fetch,
  input: TokenRefresh,
  now: () => number,
  signal: AbortSignal,
): Promise<TokenSet> {
  const sentAt = now()
  const payload = await requestTokens(
    fetchFn,
    {
      grant_type: 'refresh_token',
      client_id: input.clientId,
      refresh_token: input.refreshToken,
      resource: OPENAI_RESOURCE,
    },
    signal,
  )
  return toTokenSet(payload, sentAt, {
    kind: 'refresh',
    scopes: input.previousScopes,
    refreshToken: input.refreshToken,
  })
}

/** OpenAI answers an empty 200, also for a token that is already invalid. */
export async function revokeRefreshToken(
  fetchFn: Fetch,
  input: { clientId: string; token: string },
  signal: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await postForm(
      fetchFn,
      CHATGPT_ENDPOINTS.revoke,
      { client_id: input.clientId, token: input.token, token_type_hint: 'refresh_token' },
      withTimeout(signal, AUTH_REQUEST_TIMEOUT_MS),
    )
    await readBody(response, MAX_AUTH_BODY_BYTES)
  } catch (error) {
    throw transportError('chatgpt', error, signal, 'Token revocation')
  }
  if (!response.ok) {
    throw new ProviderError(
      'chatgpt',
      'provider_unavailable',
      `Token revocation returned HTTP ${response.status}`,
    )
  }
}

type Grant =
  | { kind: 'code'; scopes: string[] | null }
  | { kind: 'refresh'; scopes: string[]; refreshToken: string }

function toTokenSet(payload: TokenResponse, sentAt: number, grant: Grant): TokenSet {
  if (payload.token_type.toLowerCase() !== 'bearer')
    throw invalidResponse('token type is not Bearer')
  const scopes = payload.scope != null ? splitScopes(payload.scope) : grant.scopes
  if (scopes === null) throw invalidResponse('no scope')
  if (
    scopes.length > MAX_SCOPES ||
    new Set(scopes).size !== scopes.length ||
    !scopes.every((scope) => SCOPE_TOKEN.test(scope))
  ) {
    throw invalidResponse('malformed scope')
  }
  if (!scopes.includes('openid')) throw invalidResponse('openid scope missing')
  const refreshToken = payload.refresh_token ?? null
  if (scopes.includes('offline_access') && refreshToken === null) {
    throw invalidResponse('refresh token missing')
  }
  const idToken = payload.id_token ?? null
  if (grant.kind === 'code' && idToken === null) throw invalidResponse('ID token missing')
  if (grant.kind === 'refresh') {
    if (!scopes.every((scope) => grant.scopes.includes(scope))) {
      throw invalidResponse('scopes widened on refresh')
    }
    if (refreshToken === null || refreshToken === grant.refreshToken) {
      throw invalidResponse('refresh token was not rotated')
    }
  }
  return {
    accessToken: payload.access_token,
    refreshToken,
    idToken,
    expiresAt: sentAt + payload.expires_in * 1000,
    scopes,
    earliestRefreshAt: parseEarliestRefresh(payload.earliest_refresh_at),
  }
}

/** Epoch seconds or an ISO 8601 string; anything else is ignored. */
function parseEarliestRefresh(value: number | string | null | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(value)) {
    const seconds = Number(value)
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

async function requestTokens(
  fetchFn: Fetch,
  form: Record<string, string>,
  signal: AbortSignal,
): Promise<TokenResponse> {
  let response: Response
  try {
    response = await postForm(fetchFn, CHATGPT_ENDPOINTS.token, form, signal)
  } catch (error) {
    if (requestNeverSent(error)) {
      throw new TokenEndpointError('not_sent', 'The token request could not connect')
    }
    throw new TokenEndpointError('transport', 'The token request got no answer')
  }
  let text = ''
  try {
    text = await readBody(response, MAX_AUTH_BODY_BYTES)
  } catch {
    if (response.ok) throw new TokenEndpointError('transport', 'The token answer was cut off')
  }
  if (response.status === 429) {
    throw new TokenEndpointError('rate_limited', 'The token endpoint returned HTTP 429')
  }
  if (response.status >= 500) {
    throw new TokenEndpointError(
      'unavailable',
      `The token endpoint returned HTTP ${response.status}`,
    )
  }
  if (!response.ok) {
    const code = oauthErrorCode(parseJson(text))
    throw new TokenEndpointError(
      classify(code),
      `The token endpoint returned HTTP ${response.status}${code ? ` (${code})` : ''}`,
    )
  }
  const payload = TokenResponseSchema.safeParse(parseJson(text))
  if (!payload.success) throw invalidResponse('unexpected token response')
  return payload.data
}

function classify(code: string | null): TokenFailure {
  if (code === null) return 'rejected'
  if (INVALID_GRANT_CODES.has(code)) return 'invalid_grant'
  if (code === 'invalid_client') return 'invalid_client'
  if (code === 'refresh_token_too_early' || code === 'refresh_too_early') return 'too_early'
  return 'rejected'
}

function oauthErrorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null
  const error = body.error
  if (typeof error === 'string') return safeCode(error)
  if (typeof error === 'object' && error !== null && 'code' in error) return safeCode(error.code)
  return null
}

function postForm(
  fetchFn: Fetch,
  url: string,
  form: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  const entries = Object.entries(form).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return fetchFn(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(entries).toString(),
    redirect: 'manual',
    signal,
  })
}

async function getJson(
  fetchFn: Fetch,
  url: string,
  signal: AbortSignal,
  what: string,
): Promise<unknown> {
  try {
    const response = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: withTimeout(signal, AUTH_REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new ProviderError(
        'chatgpt',
        'provider_unavailable',
        `${what} returned HTTP ${response.status}`,
      )
    }
    return parseJson(await readBody(response, MAX_AUTH_BODY_BYTES))
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new ProviderError('chatgpt', 'provider_unavailable', `${what} answer is too large`)
    }
    throw transportError('chatgpt', error, signal, what)
  }
}

function invalidResponse(reason: string): TokenEndpointError {
  return new TokenEndpointError('invalid_response', `Token response rejected: ${reason}`)
}
