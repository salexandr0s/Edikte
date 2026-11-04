import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHATGPT_ENDPOINTS,
  CHATGPT_ISSUER,
  CHATGPT_SCOPES,
} from '../../../src/main/ai/chatgpt/authorization'
import { ChatGptConnection } from '../../../src/main/ai/chatgpt/connection'
import type { SecretStore } from '../../../src/main/secure/secret-store'
import {
  CLIENT_ID,
  createSigningKey,
  fakeFetch,
  json,
  memorySecretStore,
  only,
  saveChatGptSignIn,
  signIdToken,
} from './helpers'

const KEY = createSigningKey()
const START = Date.UTC(2026, 10, 4, 12)
const REDIRECT_URI = 'http://127.0.0.1:43123/auth/callback'
const HOST_ID = 'urn:uuid:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const PLAN_SCOPE = CHATGPT_SCOPES.join(' ')
const IDENTITY_SCOPE = 'openid profile email offline_access'
const DISCOVERY = {
  issuer: CHATGPT_ISSUER,
  authorization_endpoint: CHATGPT_ENDPOINTS.authorize,
  token_endpoint: CHATGPT_ENDPOINTS.token,
  revocation_endpoint: CHATGPT_ENDPOINTS.revoke,
  jwks_uri: CHATGPT_ENDPOINTS.jwks,
  code_challenge_methods_supported: ['S256'],
  id_token_signing_alg_values_supported: ['RS256'],
}

let clock = START
beforeEach(() => {
  clock = START
})

type TokenReply = (
  form: URLSearchParams,
  nonce: string | null,
  secrets: SecretStore,
) => Response | Promise<Response>

function tokens(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'access-1',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'refresh-1',
    scope: PLAN_SCOPE,
    ...overrides,
  }
}

function idToken(nonce: string | null): string {
  const issuedAt = Math.floor(clock / 1000)
  return signIdToken(KEY, {
    iss: CHATGPT_ISSUER,
    sub: 'user-1',
    aud: CLIENT_ID,
    iat: issuedAt,
    exp: issuedAt + 3600,
    email: 'max@example.com',
    ...(nonce === null ? {} : { nonce }),
  })
}

/** Answers the code grant with plan scopes and refuses every other grant. */
const signInReply: TokenReply = (form, nonce) =>
  form.get('grant_type') === 'authorization_code'
    ? json(tokens({ id_token: idToken(nonce) }))
    : json({ error: 'invalid_request' }, 400)

/** A connection with a fake browser that approves every sign-in at once. */
function harness(tokenReply: TokenReply = signInReply, secrets = memorySecretStore()) {
  const authorizeUrls: URL[] = []
  const nonce = () => authorizeUrls.at(-1)?.searchParams.get('nonce') ?? null
  const { fetch, requests } = fakeFetch({
    [`GET ${CHATGPT_ENDPOINTS.discovery}`]: () => json(DISCOVERY),
    [`GET ${CHATGPT_ENDPOINTS.jwks}`]: () => json(KEY.jwks),
    [`POST ${CHATGPT_ENDPOINTS.token}`]: (request) =>
      tokenReply(new URLSearchParams(request.body), nonce(), secrets),
    [`POST ${CHATGPT_ENDPOINTS.revoke}`]: () => new Response(null, { status: 200 }),
  })
  let deliver: (url: URL) => void = () => undefined
  const connection = new ChatGptConnection({
    secrets,
    fetch,
    now: () => clock,
    randomUUID: () => 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
    startListener: () =>
      Promise.resolve({
        redirectUri: REDIRECT_URI,
        callback: new Promise<URL>((resolve) => {
          deliver = resolve
        }),
        close: () => undefined,
      }),
    openExternal: (url) => {
      const authorize = new URL(url)
      authorizeUrls.push(authorize)
      const callback = new URL(REDIRECT_URI)
      callback.searchParams.set('code', 'code-1')
      callback.searchParams.set('state', authorize.searchParams.get('state') ?? '')
      callback.searchParams.set('client_id', CLIENT_ID)
      deliver(callback)
      return Promise.resolve()
    },
  })
  const calls = (endpoint: string) => requests.filter((request) => request.url === endpoint)
  const revoked = () =>
    calls(CHATGPT_ENDPOINTS.revoke).map((request) => new URLSearchParams(request.body).get('token'))
  return { connection, secrets, requests, authorizeUrls, calls, revoked }
}

const signal = () => new AbortController().signal

describe('ChatGPT sign-in', () => {
  it('registers, exchanges the code with PKCE and saves the verified account', async () => {
    const h = harness()
    expect(await h.connection.signIn(signal())).toEqual({
      state: 'ready',
      accountLabel: 'max@example.com',
      detail: null,
    })

    const authorize = only(h.authorizeUrls)
    const params = Object.fromEntries(authorize.searchParams)
    expect(`${authorize.origin}${authorize.pathname}`).toBe(CHATGPT_ENDPOINTS.authorize)
    expect(params).toMatchObject({
      client_id: 'dynamic_agent_client',
      ext_agent_host_id: HOST_ID,
      agent_name_hint: 'Edikte',
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: PLAN_SCOPE,
      resource: 'https://api.openai.com/v1',
      code_challenge_method: 'S256',
    })
    expect(params).not.toHaveProperty('prompt')
    expect(params).not.toHaveProperty('login_hint')

    const form = new URLSearchParams(only(h.calls(CHATGPT_ENDPOINTS.token)).body)
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: 'code-1',
      redirect_uri: REDIRECT_URI,
      resource: 'https://api.openai.com/v1',
    })
    const verifier = form.get('code_verifier') ?? ''
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(params.code_challenge)

    expect((await h.secrets.read()).chatgpt).toMatchObject({
      hostId: HOST_ID,
      clientId: CLIENT_ID,
      loginHint: 'max@example.com',
      pending: null,
      refreshDispatched: false,
    })
    const sent = h.requests.length
    await expect(h.connection.access()).resolves.toEqual({
      accessToken: 'access-1',
      subject: 'user-1',
      accountLabel: 'max@example.com',
    })
    expect(h.requests).toHaveLength(sent)
  })

  it('keeps a sign-in without plan access as identity only and asks for consent next time', async () => {
    let grants = 0
    const h = harness((_form, nonce) => {
      grants += 1
      return json(
        tokens({
          id_token: idToken(nonce),
          access_token: `access-${grants}`,
          refresh_token: `refresh-${grants}`,
          scope: grants === 1 ? IDENTITY_SCOPE : PLAN_SCOPE,
        }),
      )
    })
    expect(await h.connection.signIn(signal())).toMatchObject({ state: 'identity_only' })
    await expect(h.connection.access()).rejects.toMatchObject({ code: 'provider_auth' })

    expect(await h.connection.signIn(signal())).toMatchObject({ state: 'ready' })
    const second = Object.fromEntries(new URLSearchParams(h.authorizeUrls[1]?.search))
    expect(second).toMatchObject({
      client_id: CLIENT_ID,
      login_hint: 'max@example.com',
      prompt: 'consent',
    })
    expect(second).not.toHaveProperty('agent_name_hint')
    // The replaced sign-in's refresh token is revoked once the new one is saved.
    expect(h.revoked()).toEqual(['refresh-1'])
  })

  it('discards and revokes the tokens when the ID token does not match the sign-in', async () => {
    const h = harness(() => json(tokens({ id_token: idToken('another-nonce') })))

    await expect(h.connection.signIn(signal())).rejects.toMatchObject({ code: 'provider_auth' })
    expect((await h.secrets.read()).chatgpt).toMatchObject({ credentials: null, pending: null })
    expect(h.revoked()).toEqual(['refresh-1'])
    expect(await h.connection.status()).toMatchObject({ state: 'signed_out' })
  })

  it('clears everything but the host ID on sign-out and revokes the refresh token', async () => {
    const h = harness()
    await h.connection.signIn(signal())
    await h.connection.disconnect()

    expect((await h.secrets.read()).chatgpt).toEqual({
      hostId: HOST_ID,
      clientId: null,
      loginHint: null,
      credentials: null,
      pending: null,
      refreshDispatched: false,
    })
    const form = new URLSearchParams(only(h.calls(CHATGPT_ENDPOINTS.revoke)).body)
    expect(Object.fromEntries(form)).toEqual({
      client_id: CLIENT_ID,
      token: 'refresh-1',
      token_type_hint: 'refresh_token',
    })
  })
})

describe('ChatGPT token renewal', () => {
  /** Signs in, then moves the clock to the access token's expiry. */
  async function expiredSignIn(refreshReply: TokenReply) {
    const h = harness((form, nonce, secrets) =>
      form.get('grant_type') === 'refresh_token'
        ? refreshReply(form, nonce, secrets)
        : signInReply(form, nonce, secrets),
    )
    await h.connection.signIn(signal())
    clock += 3_600_000
    return h
  }

  it('renews an expired token once for concurrent callers and saves the rotated token', async () => {
    let refreshForm: Record<string, string> = {}
    let dispatchedWhileSent: boolean | null = null
    const h = await expiredSignIn(async (form, _nonce, secrets) => {
      refreshForm = Object.fromEntries(form)
      dispatchedWhileSent = (await secrets.read()).chatgpt.refreshDispatched
      return json(tokens({ access_token: 'access-2', refresh_token: 'refresh-2' }))
    })

    const [first, second] = await Promise.all([h.connection.access(), h.connection.access()])
    expect(first).toEqual({
      accessToken: 'access-2',
      subject: 'user-1',
      accountLabel: 'max@example.com',
    })
    expect(second).toEqual(first)
    expect(h.calls(CHATGPT_ENDPOINTS.token)).toHaveLength(2)
    expect(refreshForm).toMatchObject({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: 'refresh-1',
    })
    // The checkpoint is on disk before the request leaves.
    expect(dispatchedWhileSent).toBe(true)
    const saved = (await h.secrets.read()).chatgpt
    expect(saved.refreshDispatched).toBe(false)
    expect(saved.credentials?.tokens).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    })
  })

  const uncertain: Array<[string, TokenReply]> = [
    ['returns the same refresh token', () => json(tokens({ access_token: 'access-2' }))],
    [
      'widens the scopes',
      () =>
        json(
          tokens({
            access_token: 'access-2',
            refresh_token: 'refresh-2',
            scope: `${PLAN_SCOPE} api.admin`,
          }),
        ),
    ],
    [
      'drops the connection after the request left',
      () => Promise.reject(new TypeError('fetch failed')),
    ],
  ]

  it.each(uncertain)('asks for a new sign-in when the server %s', async (_case, reply) => {
    const h = await expiredSignIn(reply)

    await expect(h.connection.access()).rejects.toMatchObject({ code: 'provider_auth' })
    expect(await h.connection.status()).toEqual({
      state: 'signed_out',
      accountLabel: 'max@example.com',
      detail: 'Token renewal was interrupted',
    })
    const sent = h.requests.length
    await expect(h.connection.access()).rejects.toMatchObject({ code: 'provider_auth' })
    expect(h.requests).toHaveLength(sent)
    expect((await h.secrets.read()).chatgpt.refreshDispatched).toBe(true)
  })

  it('treats a renewal interrupted before the last shutdown as signed out', async () => {
    const secrets = memorySecretStore()
    await saveChatGptSignIn(secrets, { expiresAt: START + 3_600_000, refreshDispatched: true })
    const h = harness(signInReply, secrets)

    expect(await h.connection.status()).toMatchObject({
      state: 'signed_out',
      detail: 'Token renewal was interrupted',
    })
    await expect(h.connection.access()).rejects.toMatchObject({ code: 'provider_auth' })
    expect(h.requests).toHaveLength(0)
  })

  it('keeps the sign-in when the renewal request never left the machine', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const h = await expiredSignIn(() =>
      Promise.reject(new TypeError('fetch failed', { cause: refused })),
    )

    await expect(h.connection.access()).rejects.toMatchObject({ code: 'network' })
    expect((await h.secrets.read()).chatgpt.refreshDispatched).toBe(false)
    expect(await h.connection.status()).toMatchObject({ state: 'ready' })
  })

  it('clears the sign-in when the refresh token is rejected', async () => {
    const h = await expiredSignIn(() => json({ error: 'invalid_grant' }, 400))

    await expect(h.connection.access()).rejects.toMatchObject({ code: 'provider_auth' })
    expect((await h.secrets.read()).chatgpt).toMatchObject({
      clientId: CLIENT_ID,
      credentials: null,
      refreshDispatched: false,
    })
    expect(await h.connection.status()).toEqual({
      state: 'signed_out',
      accountLabel: null,
      detail: null,
    })
  })

  it('waits for earliest_refresh_at while the token is still valid', async () => {
    const h = harness((_form, nonce) =>
      json(
        tokens({
          id_token: idToken(nonce),
          earliest_refresh_at: Math.floor(START / 1000) + 3590,
        }),
      ),
    )
    await h.connection.signIn(signal())
    clock = START + 3_570_000

    await expect(h.connection.access()).resolves.toMatchObject({ accessToken: 'access-1' })
    expect(h.calls(CHATGPT_ENDPOINTS.token)).toHaveLength(1)
  })
})
