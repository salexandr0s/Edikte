import { createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
import { CHATGPT_ISSUER, constantTimeEqual } from './authorization'

export const JwksSchema = z.object({
  keys: z.array(
    z.object({
      kty: z.string(),
      kid: z.string().optional(),
      use: z.string().optional(),
      alg: z.string().optional(),
      n: z.string().optional(),
      e: z.string().optional(),
    }),
  ),
})
export type Jwks = z.infer<typeof JwksSchema>

const HeaderSchema = z.looseObject({ alg: z.string(), kid: z.string().min(1) })

const ClaimsSchema = z.object({
  iss: z.string(),
  sub: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string()).min(1)]),
  azp: z.string().optional(),
  exp: z.number(),
  iat: z.number(),
  nbf: z.number().optional(),
  nonce: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
})

/** Seconds of clock difference accepted for iat, nbf and exp; PC clocks are often minutes off. */
const CLOCK_SKEW_S = 300
const FORBIDDEN_HEADER_FIELDS = ['jku', 'jwk', 'x5u', 'x5c', 'crit']
const SEGMENT = /^[A-Za-z0-9_-]+$/

export type IdTokenFailure = 'invalid' | 'expired' | 'not_yet_valid' | 'changed_identity'

export class IdTokenError extends Error {
  constructor(
    readonly failure: IdTokenFailure,
    message: string,
  ) {
    super(message)
  }
}

/** A failed time claim. The time claims are checked last, so every other check passed. */
export function isClockFailure(error: IdTokenError): boolean {
  return error.failure === 'expired' || error.failure === 'not_yet_valid'
}

export interface IdTokenExpectations {
  clientId: string
  /** The sign-in nonce; null for tokens from a refresh. */
  nonce: string | null
  /** The saved account's subject; null on a new sign-in. */
  subject: string | null
  /** Epoch milliseconds. */
  now: number
}

export interface VerifiedIdentity {
  subject: string
  email: string | null
  name: string | null
}

/** Verifies an RS256 ID token against the issuer's JWKS and returns the account. */
export function verifyIdToken(
  token: string,
  jwks: Jwks,
  expected: IdTokenExpectations,
): VerifiedIdentity {
  const segments = token.split('.')
  const [encodedHeader, encodedPayload, encodedSignature] = segments
  if (
    segments.length !== 3 ||
    encodedHeader === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    !segments.every((segment) => SEGMENT.test(segment))
  ) {
    throw invalid('malformed token')
  }

  const header = HeaderSchema.safeParse(decodeSegment(encodedHeader))
  if (!header.success || header.data.alg !== 'RS256') throw invalid('unsupported header')
  if (FORBIDDEN_HEADER_FIELDS.some((field) => field in header.data)) {
    throw invalid('unsupported header field')
  }

  const jwk = jwks.keys.find((key) => key.kid === header.data.kid)
  if (
    !jwk ||
    jwk.kty !== 'RSA' ||
    (jwk.use !== undefined && jwk.use !== 'sig') ||
    (jwk.alg !== undefined && jwk.alg !== 'RS256') ||
    !jwk.n ||
    !jwk.e
  ) {
    throw invalid('no matching signing key')
  }
  const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })
  const modulusBytes = Math.ceil((key.asymmetricKeyDetails?.modulusLength ?? 0) / 8)
  const signature = Buffer.from(encodedSignature, 'base64url')
  if (modulusBytes < 256 || modulusBytes > 1024 || signature.length !== modulusBytes) {
    throw invalid('unexpected key or signature size')
  }
  const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii')
  if (!verify('RSA-SHA256', signed, key, signature)) throw invalid('bad signature')

  const parsed = ClaimsSchema.safeParse(decodeSegment(encodedPayload))
  if (!parsed.success) throw invalid('unexpected claims')
  const claims = parsed.data
  const nowSeconds = expected.now / 1000

  if (claims.iss !== CHATGPT_ISSUER) throw invalid('wrong issuer')
  const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud
  if (!audiences.includes(expected.clientId)) throw invalid('wrong audience')
  if ((audiences.length > 1 || claims.azp !== undefined) && claims.azp !== expected.clientId) {
    throw invalid('wrong authorized party')
  }
  if (claims.exp <= claims.iat) throw invalid('exp before iat')
  if (
    expected.nonce !== null &&
    (claims.nonce === undefined || !constantTimeEqual(claims.nonce, expected.nonce))
  ) {
    throw invalid('nonce mismatch')
  }
  if (expected.subject !== null && claims.sub !== expected.subject) {
    throw new IdTokenError('changed_identity', 'ID token belongs to another account')
  }
  if (claims.iat > nowSeconds + CLOCK_SKEW_S) throw notYetValid('issued in the future')
  if (claims.nbf !== undefined && claims.nbf > nowSeconds + CLOCK_SKEW_S) {
    throw notYetValid('not yet valid')
  }
  if (claims.exp <= nowSeconds - CLOCK_SKEW_S) {
    throw new IdTokenError('expired', 'ID token expired')
  }

  return {
    subject: claims.sub,
    email: displayText(claims.email, 320),
    name: displayText(claims.name, 200),
  }
}

function decodeSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function displayText(value: string | undefined, maxLength: number): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function invalid(reason: string): IdTokenError {
  return new IdTokenError('invalid', `ID token rejected: ${reason}`)
}

function notYetValid(reason: string): IdTokenError {
  return new IdTokenError('not_yet_valid', `ID token rejected: ${reason}`)
}
