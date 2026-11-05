import { describe, expect, it } from 'vitest'
import {
  CHATGPT_ISSUER,
  createAuthorizationAttempt,
  parseCallback,
} from '../../../src/main/ai/chatgpt/authorization'
import {
  IdTokenError,
  verifyIdToken,
  type IdTokenExpectations,
} from '../../../src/main/ai/chatgpt/id-token'
import { createSigningKey, signIdToken } from './helpers'

const KEY = createSigningKey('key-1')
const OTHER_KEY = createSigningKey('key-1')
const NOW = Date.UTC(2026, 10, 4, 12)
const NOW_S = NOW / 1000
const CLIENT_ID = 'client-123'

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: CHATGPT_ISSUER,
    sub: 'user-1',
    aud: CLIENT_ID,
    iat: NOW_S - 10,
    exp: NOW_S + 3600,
    nonce: 'nonce-1',
    email: 'max@example.com',
    ...overrides,
  }
}

const expected: IdTokenExpectations = {
  clientId: CLIENT_ID,
  nonce: 'nonce-1',
  subject: null,
  now: NOW,
}

function failure(token: string, expectations: IdTokenExpectations = expected): string | null {
  try {
    verifyIdToken(token, KEY.jwks, expectations)
    return null
  } catch (error) {
    return error instanceof IdTokenError ? error.failure : 'other'
  }
}

describe('ID token verification', () => {
  it('accepts a token signed by the published key and returns the account', () => {
    expect(verifyIdToken(signIdToken(KEY, claims()), KEY.jwks, expected)).toEqual({
      subject: 'user-1',
      email: 'max@example.com',
      name: null,
    })
  })

  it.each([
    ['another issuer', signIdToken(KEY, claims({ iss: 'https://evil.example' })), 'invalid'],
    ['another audience', signIdToken(KEY, claims({ aud: 'client-999' })), 'invalid'],
    [
      'several audiences without azp',
      signIdToken(KEY, claims({ aud: [CLIENT_ID, 'x'] })),
      'invalid',
    ],
    ['a foreign azp', signIdToken(KEY, claims({ azp: 'client-999' })), 'invalid'],
    ['another nonce', signIdToken(KEY, claims({ nonce: 'nonce-2' })), 'invalid'],
    [
      'an issue time in the future',
      signIdToken(KEY, claims({ iat: NOW_S + 600 })),
      'not_yet_valid',
    ],
    [
      'an expired token',
      signIdToken(KEY, claims({ iat: NOW_S - 4000, exp: NOW_S - 400 })),
      'expired',
    ],
    ['an HS256 header', signIdToken(KEY, claims(), { alg: 'HS256' }), 'invalid'],
    ['a jku header', signIdToken(KEY, claims(), { jku: 'https://evil.example/jwks' }), 'invalid'],
    ['an unknown key ID', signIdToken(KEY, claims(), { kid: 'key-2' }), 'invalid'],
    ['a signature from another key', signIdToken(OTHER_KEY, claims()), 'invalid'],
  ])('rejects %s', (_case, token, expectedFailure) => {
    expect(failure(token)).toBe(expectedFailure)
  })

  it('rejects a changed payload', () => {
    const [header, , signature] = signIdToken(KEY, claims()).split('.')
    const forged = Buffer.from(JSON.stringify(claims({ sub: 'user-2' }))).toString('base64url')
    expect(failure(`${header}.${forged}.${signature}`)).toBe('invalid')
  })

  it.each([
    ['an issue time four minutes ahead', claims({ iat: NOW_S + 240 })],
    ['an expiry four minutes past', claims({ iat: NOW_S - 3600, exp: NOW_S - 240 })],
  ])('accepts %s as clock difference', (_case, payload) => {
    expect(verifyIdToken(signIdToken(KEY, payload), KEY.jwks, expected).subject).toBe('user-1')
  })

  it('reports another account on renewal', () => {
    const token = signIdToken(KEY, claims({ sub: 'user-2', nonce: undefined }))
    expect(failure(token, { ...expected, nonce: null, subject: 'user-1' })).toBe('changed_identity')
  })
})

describe('callback checks', () => {
  const attempt = createAuthorizationAttempt((size) => Buffer.alloc(size, 7), NOW)
  const callback = (query: string) => new URL(`http://127.0.0.1:5000/auth/callback?${query}`)
  const state = `state=${attempt.state}`

  it.each([
    ['a declined consent', `${state}&error=access_denied`, null, { kind: 'denied' }],
    ['a repeated state', `${state}&${state}&code=c&client_id=x`, null, { kind: 'failed' }],
    ['another state', 'state=other&code=c&client_id=x', null, { kind: 'failed' }],
    [
      'the dynamic client ID',
      `${state}&code=c&client_id=dynamic_agent_client`,
      null,
      { kind: 'failed' },
    ],
    ['a changed client ID', `${state}&code=c&client_id=client-2`, 'client-1', { kind: 'failed' }],
    ['no client ID on a first sign-in', `${state}&code=c`, null, { kind: 'failed' }],
    ['a code with a space', `${state}&code=a%20b&client_id=x`, null, { kind: 'failed' }],
    [
      'a valid callback',
      `${state}&code=c&client_id=client-1`,
      null,
      { kind: 'code', clientId: 'client-1' },
    ],
    ['the saved client ID', `${state}&code=c`, 'client-1', { kind: 'code', clientId: 'client-1' }],
  ])('handles %s', (_case, query, savedClientId, outcome) => {
    expect(parseCallback(callback(query), attempt, NOW + 1000, savedClientId)).toMatchObject(
      outcome,
    )
  })

  it('takes a new client ID when no saved sign-in depends on the old one', () => {
    const outcome = parseCallback(
      callback(`${state}&code=c&client_id=client-2`),
      attempt,
      NOW + 1000,
      'client-1',
      { acceptNewClientId: true },
    )
    expect(outcome).toMatchObject({ kind: 'code', clientId: 'client-2' })
  })

  it('rejects a callback after ten minutes', () => {
    const outcome = parseCallback(
      callback(`${state}&code=c&client_id=x`),
      attempt,
      NOW + 601_000,
      null,
    )
    expect(outcome).toEqual({ kind: 'failed', reason: 'sign-in expired' })
  })
})
