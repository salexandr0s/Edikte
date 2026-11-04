import { createHash, timingSafeEqual } from 'node:crypto'

export const CHATGPT_ISSUER = 'https://auth.openai.com'

export const CHATGPT_ENDPOINTS = {
  authorize: `${CHATGPT_ISSUER}/api/accounts/authorize`,
  token: `${CHATGPT_ISSUER}/api/accounts/oauth/token`,
  revoke: `${CHATGPT_ISSUER}/api/accounts/oauth/revoke`,
  jwks: `${CHATGPT_ISSUER}/.well-known/jwks.json`,
  discovery: `${CHATGPT_ISSUER}/.well-known/openid-configuration`,
} as const

/** Client ID for the first sign-in; the callback returns the issued one. */
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
export const OPENAI_RESOURCE = 'https://api.openai.com/v1'
export const CHATGPT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  'chatgpt.tokens.use.direct',
] as const
/** Without these the account signs in but cannot call models (`identity_only`). */
export const PLAN_SCOPES = ['resource.invoke', 'chatgpt.tokens.use.direct'] as const
export const CALLBACK_PATH = '/auth/callback'
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

const MAX_CODE_BYTES = 16384
const SINGLE_VALUE_PARAMS = ['code', 'state', 'client_id', 'error', 'error_description', 'scope']

export interface AuthorizationAttempt {
  state: string
  nonce: string
  verifier: string
  challenge: string
  startedAt: number
}

export function createAuthorizationAttempt(
  random: (size: number) => Buffer,
  now: number,
): AuthorizationAttempt {
  const verifier = random(32).toString('base64url')
  return {
    state: random(32).toString('base64url'),
    nonce: random(32).toString('base64url'),
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    startedAt: now,
  }
}

export interface AuthorizeUrlOptions {
  attempt: AuthorizationAttempt
  redirectUri: string
  hostId: string
  /** Issued client ID; null before the first sign-in. */
  clientId: string | null
  loginHint: string | null
  /** Asks again for the plan scopes when the saved sign-in lacks them. */
  requestConsent: boolean
  agentName: string
}

export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  const params = new URLSearchParams({
    client_id: options.clientId ?? DYNAMIC_CLIENT_ID,
    ext_agent_host_id: options.hostId,
    response_type: 'code',
    redirect_uri: options.redirectUri,
    scope: CHATGPT_SCOPES.join(' '),
    resource: OPENAI_RESOURCE,
    state: options.attempt.state,
    nonce: options.attempt.nonce,
    code_challenge_method: 'S256',
    code_challenge: options.attempt.challenge,
  })
  if (options.clientId === null) params.set('agent_name_hint', options.agentName)
  else if (options.loginHint) params.set('login_hint', options.loginHint)
  if (options.requestConsent) params.set('prompt', 'consent')
  // URLSearchParams writes spaces as "+"; percent-encoding is the safer reading for scope.
  return `${CHATGPT_ENDPOINTS.authorize}?${params.toString().replaceAll('+', '%20')}`
}

export type CallbackOutcome =
  | { kind: 'code'; code: string; clientId: string; scopes: string[] | null }
  | { kind: 'denied' }
  | { kind: 'failed'; reason: string }

/**
 * Checks the redirect the loopback listener accepted. The listener already
 * matched the state; this checks it again along with the rest.
 */
export function parseCallback(
  url: URL,
  attempt: AuthorizationAttempt,
  now: number,
  savedClientId: string | null,
): CallbackOutcome {
  if (now - attempt.startedAt > SIGN_IN_TIMEOUT_MS) return failed('sign-in expired')
  const params = url.searchParams
  for (const name of SINGLE_VALUE_PARAMS) {
    if (params.getAll(name).length > 1) return failed(`repeated ${name}`)
  }
  const state = params.get('state')
  if (state === null || !constantTimeEqual(state, attempt.state)) return failed('state mismatch')

  const error = params.get('error')
  if (error !== null) {
    if (error === 'access_denied') return { kind: 'denied' }
    return failed(/^[a-z0-9_.-]{1,64}$/i.test(error) ? error : 'error')
  }

  const code = params.get('code')
  if (code === null || !isToken(code)) return failed('invalid code')

  const returnedClientId = params.get('client_id')
  if (returnedClientId !== null) {
    if (returnedClientId === DYNAMIC_CLIENT_ID || !isToken(returnedClientId)) {
      return failed('invalid client_id')
    }
    if (savedClientId !== null && returnedClientId !== savedClientId) {
      return failed('client_id changed')
    }
  }
  const clientId = returnedClientId ?? savedClientId
  if (clientId === null) return failed('no client_id issued')

  const scope = params.get('scope')
  return { kind: 'code', code, clientId, scopes: scope === null ? null : splitScopes(scope) }
}

export function hasPlanScopes(scopes: readonly string[]): boolean {
  return PLAN_SCOPES.every((scope) => scopes.includes(scope))
}

export function splitScopes(scope: string): string[] {
  return scope.split(' ').filter((entry) => entry.length > 0)
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Printable ASCII without spaces, as OAuth codes and client IDs are. */
function isToken(value: string): boolean {
  return (
    value.length > 0 && Buffer.byteLength(value) <= MAX_CODE_BYTES && /^[\x21-\x7e]+$/.test(value)
  )
}

function failed(reason: string): CallbackOutcome {
  return { kind: 'failed', reason }
}
