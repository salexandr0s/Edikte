import { randomBytes as cryptoRandomBytes, randomUUID as cryptoRandomUUID } from 'node:crypto'
import { AppError } from '@shared/errors'
import { log } from '../../log'
import {
  emptyChatGptSecrets,
  type ChatGptSecrets,
  type SecretStore,
  type StoredIdentity,
  type StoredTokenSet,
} from '../../secure/secret-store'
import type { Fetch } from '../api/common'
import { ProviderError } from '../provider'
import {
  buildAuthorizeUrl,
  createAuthorizationAttempt,
  hasPlanScopes,
  parseCallback,
} from './authorization'
import { IdTokenError, verifyIdToken, type VerifiedIdentity } from './id-token'
import { startLoopbackListener, type StartLoopbackListener } from './loopback-listener'
import {
  AUTH_REQUEST_TIMEOUT_MS,
  TokenEndpointError,
  checkDiscovery,
  exchangeCode,
  fetchJwks,
  refreshTokens,
  revokeRefreshToken,
  type TokenSet,
} from './token-client'

/** Access tokens are renewed this long before they expire. */
const REFRESH_MARGIN_MS = 60_000

export type ChatGptConnectionState = 'signed_out' | 'signing_in' | 'ready' | 'identity_only'

export interface ChatGptConnectionStatus {
  state: ChatGptConnectionState
  accountLabel: string | null
  detail: string | null
}

export interface ChatGptAccess {
  accessToken: string
  subject: string
  accountLabel: string | null
}

export interface ChatGptConnectionDeps {
  secrets: SecretStore
  /** Opens the authorize URL in the system browser (shell.openExternal in the app). */
  openExternal: (url: string) => Promise<void>
  fetch?: Fetch
  now?: () => number
  randomBytes?: (size: number) => Buffer
  randomUUID?: () => string
  startListener?: StartLoopbackListener
  /** Name OpenAI shows when the app registers on the first sign-in. */
  agentName?: string
}

interface Credentials {
  tokens: StoredTokenSet
  identity: StoredIdentity
}

/**
 * Sign in with ChatGPT: browser sign-in, token storage and renewal. Refresh
 * tokens rotate on every renewal, so at most one renewal runs at a time and
 * `refreshDispatched` is saved before each request: if the app stops before
 * the answer is saved, the next start asks the user to sign in again instead
 * of reusing a token the server may already have replaced.
 */
export class ChatGptConnection {
  private readonly secrets: SecretStore
  private readonly openExternal: (url: string) => Promise<void>
  private readonly fetch: Fetch
  private readonly now: () => number
  private readonly randomBytes: (size: number) => Buffer
  private readonly randomUUID: () => string
  private readonly startListener: StartLoopbackListener
  private readonly agentName: string
  private signingIn = false
  private refreshing: Promise<ChatGptAccess> | null = null

  constructor(deps: ChatGptConnectionDeps) {
    this.secrets = deps.secrets
    this.openExternal = deps.openExternal
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
    this.randomBytes = deps.randomBytes ?? cryptoRandomBytes
    this.randomUUID = deps.randomUUID ?? cryptoRandomUUID
    this.startListener = deps.startListener ?? startLoopbackListener
    this.agentName = deps.agentName ?? 'Edikte'
  }

  /** Reads saved state only; no network. */
  async status(): Promise<ChatGptConnectionStatus> {
    if (this.signingIn) return { state: 'signing_in', accountLabel: null, detail: null }
    const { chatgpt } = await this.secrets.read()
    const credentials = chatgpt.credentials
    if (!credentials) return { state: 'signed_out', accountLabel: null, detail: null }
    const accountLabel = labelOf(credentials.identity)
    if (chatgpt.refreshDispatched && !this.refreshing) {
      return { state: 'signed_out', accountLabel, detail: 'Token renewal was interrupted' }
    }
    if (credentials.tokens.refreshToken === null && credentials.tokens.expiresAt <= this.now()) {
      return { state: 'signed_out', accountLabel, detail: 'The session expired' }
    }
    if (!hasPlanScopes(credentials.tokens.scopes)) {
      return { state: 'identity_only', accountLabel, detail: null }
    }
    return { state: 'ready', accountLabel, detail: null }
  }

  async signIn(signal: AbortSignal): Promise<ChatGptConnectionStatus> {
    if (this.signingIn) {
      throw new ProviderError('chatgpt', 'busy', 'A ChatGPT sign-in is already running')
    }
    if (!this.secrets.canWrite()) {
      throw new ProviderError(
        'chatgpt',
        'storage_unavailable',
        'The system offers no encryption for saved secrets',
      )
    }
    this.signingIn = true
    try {
      await this.runSignIn(signal)
    } finally {
      this.signingIn = false
    }
    return this.status()
  }

  /** A usable access token, renewed first when it expires within a minute. */
  async access(): Promise<ChatGptAccess> {
    if (this.refreshing) return this.refreshing
    const { chatgpt } = await this.secrets.read()
    if (this.refreshing) return this.refreshing
    const credentials = chatgpt.credentials
    if (!credentials) {
      throw new ProviderError('chatgpt', 'provider_not_connected', 'ChatGPT is not connected')
    }
    if (chatgpt.refreshDispatched) throw signInAgain('Token renewal was interrupted')
    if (!hasPlanScopes(credentials.tokens.scopes)) {
      throw new ProviderError(
        'chatgpt',
        'provider_auth',
        'This ChatGPT sign-in has no access to models',
      )
    }
    const { tokens } = credentials
    const now = this.now()
    const refreshBlocked =
      tokens.earliestRefreshAt !== null && now < tokens.earliestRefreshAt && tokens.expiresAt > now
    if (tokens.expiresAt - now > REFRESH_MARGIN_MS || refreshBlocked) return accessOf(credentials)
    const clientId = chatgpt.clientId
    if (tokens.refreshToken === null || clientId === null) throw signInAgain('The session expired')

    const refresh = this.refresh(clientId, credentials, tokens.refreshToken).finally(() => {
      this.refreshing = null
    })
    this.refreshing = refresh
    return refresh
  }

  async currentSubject(): Promise<string | null> {
    const { chatgpt } = await this.secrets.read()
    return chatgpt.credentials?.identity.subject ?? null
  }

  /** Clears local state first, then revokes the refresh tokens it held. */
  async disconnect(): Promise<void> {
    await this.refreshing?.catch(() => undefined)
    const { chatgpt } = await this.secrets.read()
    const tokens = new Set(
      [chatgpt.pending?.refreshToken, chatgpt.credentials?.tokens.refreshToken].filter(
        (token): token is string => typeof token === 'string',
      ),
    )
    await this.updateChatGpt((current) => ({ ...emptyChatGptSecrets(), hostId: current.hostId }))
    const clientId = chatgpt.clientId
    if (clientId === null) return
    for (const token of tokens) await this.revokeQuietly(clientId, token)
  }

  private async runSignIn(signal: AbortSignal): Promise<void> {
    const { saved, hostId } = await this.ensureHostId()
    await checkDiscovery(this.fetch, signal)
    const attempt = createAuthorizationAttempt(this.randomBytes, this.now())
    const listener = await this.startListener({ state: attempt.state, signal })
    let callbackUrl: URL
    try {
      await this.openExternal(
        buildAuthorizeUrl({
          attempt,
          redirectUri: listener.redirectUri,
          hostId,
          clientId: saved.clientId,
          loginHint: saved.loginHint,
          requestConsent:
            saved.credentials !== null && !hasPlanScopes(saved.credentials.tokens.scopes),
          agentName: this.agentName,
        }),
      )
      callbackUrl = await listener.callback
    } finally {
      listener.close()
    }

    const outcome = parseCallback(callbackUrl, attempt, this.now(), saved.clientId)
    if (outcome.kind === 'denied') {
      throw new ProviderError('chatgpt', 'provider_auth', 'The ChatGPT sign-in was declined')
    }
    if (outcome.kind === 'failed') {
      throw new ProviderError(
        'chatgpt',
        'provider_auth',
        `The ChatGPT sign-in failed: ${outcome.reason}`,
      )
    }
    const clientId = outcome.clientId
    // Saved before the exchange, so a crash does not lose the registration.
    await this.updateChatGpt((current) => ({ ...current, clientId }))

    let tokens: TokenSet
    try {
      tokens = await exchangeCode(
        this.fetch,
        {
          clientId,
          code: outcome.code,
          verifier: attempt.verifier,
          redirectUri: listener.redirectUri,
          callbackScopes: outcome.scopes,
        },
        this.now,
        signal,
      )
    } catch (error) {
      if (error instanceof TokenEndpointError && error.failure === 'invalid_client') {
        await this.updateChatGpt((current) => ({ ...current, clientId: null, loginHint: null }))
      }
      throw exchangeError(error, signal)
    }

    // Saved before the ID token check, so the refresh token can be revoked if it fails.
    await this.updateChatGpt((current) => ({ ...current, pending: stored(tokens) }))
    let identity: VerifiedIdentity
    try {
      if (tokens.idToken === null) throw new IdTokenError('invalid', 'ID token missing')
      const jwks = await fetchJwks(this.fetch, signal)
      identity = verifyIdToken(tokens.idToken, jwks, {
        clientId,
        nonce: attempt.nonce,
        subject: null,
        now: this.now(),
      })
    } catch (error) {
      await this.discardPending(clientId)
      if (error instanceof IdTokenError) {
        throw new ProviderError('chatgpt', 'provider_auth', error.message)
      }
      throw error
    }

    await this.refreshing?.catch(() => undefined)
    const previous = (await this.secrets.read()).chatgpt.credentials?.tokens.refreshToken ?? null
    await this.updateChatGpt((current) => ({
      ...current,
      credentials: { tokens: stored(tokens), identity },
      pending: null,
      refreshDispatched: false,
      loginHint: identity.email,
    }))
    if (previous !== null && previous !== tokens.refreshToken) {
      await this.revokeQuietly(clientId, previous)
    }
  }

  private async refresh(
    clientId: string,
    credentials: Credentials,
    refreshToken: string,
  ): Promise<ChatGptAccess> {
    await this.updateChatGpt((current) => ({ ...current, refreshDispatched: true }))
    let next: TokenSet
    try {
      // Not tied to the caller's signal: dropping a sent request would lose the rotated token.
      next = await refreshTokens(
        this.fetch,
        { clientId, refreshToken, previousScopes: credentials.tokens.scopes },
        this.now,
        AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
      )
    } catch (error) {
      return this.refreshFailed(error, credentials, refreshToken)
    }

    const saved = await this.updateChatGpt((current) =>
      current.credentials?.tokens.refreshToken === refreshToken
        ? {
            ...current,
            credentials: { tokens: stored(next), identity: credentials.identity },
            refreshDispatched: false,
          }
        : current,
    )
    if (saved.credentials?.tokens.accessToken !== next.accessToken) {
      // A sign-out or a new sign-in replaced the account while the request ran.
      if (next.refreshToken !== null) await this.revokeQuietly(clientId, next.refreshToken)
      throw new ProviderError(
        'chatgpt',
        'provider_account_changed',
        'The ChatGPT sign-in changed during token renewal',
      )
    }
    if (next.idToken === null)
      return accessOf({ tokens: stored(next), identity: credentials.identity })

    let identity: VerifiedIdentity
    try {
      const jwks = await fetchJwks(this.fetch, AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS))
      identity = verifyIdToken(next.idToken, jwks, {
        clientId,
        nonce: null,
        subject: credentials.identity.subject,
        now: this.now(),
      })
    } catch (error) {
      if (!(error instanceof IdTokenError)) {
        // The renewed tokens are saved; the account stays the one verified at sign-in.
        log.warn('chatgpt', 'ID token from renewal not checked, signing keys unavailable')
        return accessOf({ tokens: stored(next), identity: credentials.identity })
      }
      await this.updateChatGpt((current) => ({
        ...current,
        credentials: null,
        pending: null,
        refreshDispatched: false,
      }))
      if (next.refreshToken !== null) await this.revokeQuietly(clientId, next.refreshToken)
      throw signInAgain(error.message)
    }
    await this.updateChatGpt((current) =>
      current.credentials?.tokens.accessToken === next.accessToken
        ? {
            ...current,
            credentials: { tokens: current.credentials.tokens, identity },
            loginHint: identity.email ?? current.loginHint,
          }
        : current,
    )
    return accessOf({ tokens: stored(next), identity })
  }

  private async refreshFailed(
    error: unknown,
    credentials: Credentials,
    refreshToken: string,
  ): Promise<ChatGptAccess> {
    const failure = error instanceof TokenEndpointError ? error.failure : 'transport'
    const message = error instanceof Error ? error.message : 'Token renewal failed'
    switch (failure) {
      case 'not_sent':
      case 'rate_limited':
      case 'unavailable':
      case 'too_early': {
        // No new tokens were issued, so the saved ones stay valid.
        await this.updateChatGpt((current) => ({ ...current, refreshDispatched: false }))
        if (failure === 'too_early' && credentials.tokens.expiresAt > this.now()) {
          return accessOf(credentials)
        }
        const code =
          failure === 'not_sent'
            ? 'network'
            : failure === 'unavailable'
              ? 'provider_unavailable'
              : 'provider_rate_limit'
        throw new ProviderError('chatgpt', code, message)
      }
      case 'invalid_grant':
      case 'invalid_client':
        await this.updateChatGpt((current) =>
          current.credentials?.tokens.refreshToken === refreshToken
            ? {
                ...current,
                ...(failure === 'invalid_client' ? { clientId: null, loginHint: null } : {}),
                credentials: null,
                pending: null,
                refreshDispatched: false,
              }
            : current,
        )
        throw signInAgain(message)
      default:
        // The server may have rotated the token; reusing the old one could end
        // the grant. refreshDispatched stays set until the next sign-in.
        log.warn('chatgpt', 'token renewal outcome unknown', { failure })
        throw signInAgain(message)
    }
  }

  private async ensureHostId(): Promise<{ saved: ChatGptSecrets; hostId: string }> {
    const { chatgpt } = await this.secrets.read()
    if (chatgpt.hostId !== null) return { saved: chatgpt, hostId: chatgpt.hostId }
    const hostId = `urn:uuid:${this.randomUUID().toLowerCase()}`
    const saved = await this.updateChatGpt((current) => ({
      ...current,
      hostId: current.hostId ?? hostId,
    }))
    return { saved, hostId: saved.hostId ?? hostId }
  }

  private async discardPending(clientId: string): Promise<void> {
    const token = (await this.secrets.read()).chatgpt.pending?.refreshToken ?? null
    await this.updateChatGpt((current) => ({ ...current, pending: null }))
    if (token !== null) await this.revokeQuietly(clientId, token)
  }

  private async revokeQuietly(clientId: string, token: string): Promise<void> {
    try {
      await revokeRefreshToken(
        this.fetch,
        { clientId, token },
        AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
      )
    } catch (error) {
      log.warn('chatgpt', 'token revocation failed', {
        code: error instanceof AppError ? error.code : 'unknown',
      })
    }
  }

  private async updateChatGpt(
    change: (current: ChatGptSecrets) => ChatGptSecrets,
  ): Promise<ChatGptSecrets> {
    const next = await this.secrets.update((all) => ({ ...all, chatgpt: change(all.chatgpt) }))
    return next.chatgpt
  }
}

function exchangeError(error: unknown, signal: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error
  if (signal.aborted) {
    return new ProviderError('chatgpt', 'cancelled', 'The ChatGPT sign-in was cancelled')
  }
  if (!(error instanceof TokenEndpointError)) {
    return new ProviderError('chatgpt', 'internal', 'The ChatGPT sign-in failed')
  }
  switch (error.failure) {
    case 'not_sent':
    case 'transport':
      return new ProviderError('chatgpt', 'network', error.message)
    case 'rate_limited':
      return new ProviderError('chatgpt', 'provider_rate_limit', error.message)
    case 'unavailable':
      return new ProviderError('chatgpt', 'provider_unavailable', error.message)
    default:
      return new ProviderError('chatgpt', 'provider_auth', error.message)
  }
}

function signInAgain(reason: string): ProviderError {
  return new ProviderError('chatgpt', 'provider_auth', `${reason}. Sign in to ChatGPT again.`)
}

function stored(tokens: TokenSet): StoredTokenSet {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    earliestRefreshAt: tokens.earliestRefreshAt,
  }
}

function labelOf(identity: StoredIdentity): string | null {
  return identity.email ?? identity.name
}

function accessOf(credentials: Credentials): ChatGptAccess {
  return {
    accessToken: credentials.tokens.accessToken,
    subject: credentials.identity.subject,
    accountLabel: labelOf(credentials.identity),
  }
}
