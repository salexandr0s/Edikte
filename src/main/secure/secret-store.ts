import { randomBytes } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import { log } from '../log'

/**
 * One encrypted file with the ChatGPT tokens and the API keys. Encryption is
 * injected (safeStorage in the app, a fake in tests). Nothing here is ever
 * logged or sent to the renderer.
 */
export interface SecretEncryption {
  isAvailable(): boolean
  encrypt(plainText: string): Buffer
  decrypt(cipherText: Buffer): string
}

/** File operations the store needs; replaceable so tests can fail a step. */
export interface SecretFiles {
  /** Returns null when the file does not exist. */
  read(file: string): Promise<Buffer | null>
  /** Creates a new file readable only by the user, writes it and flushes it to disk. */
  writeNew(file: string, data: Buffer): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(file: string): Promise<void>
}

const TokenSetSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  /** Epoch milliseconds. */
  expiresAt: z.number().int(),
  scopes: z.array(z.string().min(1)),
  /** Epoch milliseconds before which the server refuses a refresh. */
  earliestRefreshAt: z.number().int().nullable(),
})
export type StoredTokenSet = z.infer<typeof TokenSetSchema>

const IdentitySchema = z.object({
  subject: z.string().min(1),
  email: z.string().nullable(),
  name: z.string().nullable(),
})
export type StoredIdentity = z.infer<typeof IdentitySchema>

const ChatGptSecretsSchema = z.object({
  /** `urn:uuid:…` sent as ext_agent_host_id. Created once and kept across sign-outs. */
  hostId: z.string().nullable(),
  /** Client ID issued by dynamic registration on the first sign-in. */
  clientId: z.string().nullable(),
  /** Email of the last verified sign-in, sent as login_hint with the issued client ID. */
  loginHint: z.string().nullable(),
  credentials: z.object({ tokens: TokenSetSchema, identity: IdentitySchema }).nullable(),
  /** Tokens between code exchange and ID token check, kept so they can be revoked. */
  pending: TokenSetSchema.nullable(),
  /** Set before a refresh request leaves. Still set later means the outcome is unknown. */
  refreshDispatched: z.boolean(),
})
export type ChatGptSecrets = z.infer<typeof ChatGptSecretsSchema>

const SecretsSchema = z.object({
  chatgpt: ChatGptSecretsSchema,
  apiKeys: z.object({
    openai: z.string().min(1).nullable(),
    anthropic: z.string().min(1).nullable(),
  }),
})
export type Secrets = z.infer<typeof SecretsSchema>

const EnvelopeSchema = z.object({ version: z.literal(1), data: z.string().min(1) })

export function emptyChatGptSecrets(): ChatGptSecrets {
  return {
    hostId: null,
    clientId: null,
    loginHint: null,
    credentials: null,
    pending: null,
    refreshDispatched: false,
  }
}

export function emptySecrets(): Secrets {
  return { chatgpt: emptyChatGptSecrets(), apiKeys: { openai: null, anthropic: null } }
}

export interface SecretStore {
  /** False when the OS offers no encryption; nothing can be stored then. */
  canWrite(): boolean
  read(): Promise<Secrets>
  /** Applies `change` to the latest state and saves it. Calls run one at a time. */
  update(change: (current: Secrets) => Secrets): Promise<Secrets>
}

export interface SecretStoreOptions {
  file: string
  encryption: SecretEncryption
  files?: SecretFiles
}

export const nodeSecretFiles: SecretFiles = {
  async read(file) {
    try {
      return await fsp.readFile(file)
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  },
  async writeNew(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const handle = await fsp.open(file, 'wx', 0o600)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  rename: (from, to) => fsp.rename(from, to),
  remove: (file) => fsp.rm(file, { force: true }),
}

export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const { file, encryption } = options
  const files = options.files ?? nodeSecretFiles
  let cache: Secrets | null = null
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  async function load(): Promise<Secrets> {
    if (cache) return cache
    const data = await files.read(file).catch((error: unknown) => {
      throw new AppError('storage_unavailable', 'The secret file could not be read', {
        cause: error,
      })
    })
    if (data === null) {
      cache = emptySecrets()
      return cache
    }
    if (!encryption.isAvailable()) throw unavailable()
    cache = decode(data)
    return cache
  }

  function decode(data: Buffer): Secrets {
    try {
      const envelope = EnvelopeSchema.parse(JSON.parse(data.toString('utf8')))
      const plainText = encryption.decrypt(Buffer.from(envelope.data, 'base64'))
      return SecretsSchema.parse(JSON.parse(plainText))
    } catch {
      // A copied file or a reset keychain cannot be decrypted. The user signs
      // in again and the next save replaces the file.
      log.warn('secrets', 'secret file unreadable, starting empty')
      return emptySecrets()
    }
  }

  async function persist(secrets: Secrets): Promise<void> {
    const cipherText = encryption.encrypt(JSON.stringify(secrets))
    const envelope = JSON.stringify({ version: 1, data: cipherText.toString('base64') })
    const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await files.writeNew(temp, Buffer.from(envelope, 'utf8'))
      await files.rename(temp, file)
    } catch (error) {
      await files.remove(temp).catch(() => undefined)
      throw new AppError('storage_unavailable', 'The secret file could not be saved', {
        cause: error,
      })
    }
  }

  return {
    canWrite: () => encryption.isAvailable(),
    read: () => enqueue(load),
    update: (change) =>
      enqueue(async () => {
        if (!encryption.isAvailable()) throw unavailable()
        const current = await load()
        const next = SecretsSchema.parse(change(current))
        await persist(next)
        cache = next
        return next
      }),
  }
}

function unavailable(): AppError {
  return new AppError('storage_unavailable', 'The system offers no encryption for saved secrets')
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
