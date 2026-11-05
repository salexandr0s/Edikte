import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError, isAppError } from '@shared/errors'
import { eventContract } from '@shared/ipc'
import {
  PROVIDER_KINDS,
  type ModelOption,
  type ProviderId,
  type ProviderState,
  type ProviderStatus,
} from '@shared/providers'
import type { AiProvider, ProviderDetection } from '../../../src/main/ai/provider'
import { openDatabase, type AppDatabase } from '../../../src/main/db/client'
import type { EmitEvent } from '../../../src/main/ipc/events'
import type { SecretEncryption } from '../../../src/main/secure/secret-store'
import {
  createProviderService,
  type ProviderContext,
  type ProviderService,
} from '../../../src/main/services/providers'

export const NOW = new Date('2026-11-05T10:00:00.000Z')

export function detectionFor(
  id: ProviderId,
  state: ProviderState,
  extra: Partial<ProviderDetection> = {},
): ProviderDetection {
  return {
    id,
    state,
    version: null,
    binaryPath: null,
    binaryPathSource: null,
    accountLabel: state === 'ready' ? 'you@example.com' : null,
    plan: null,
    detail: null,
    checkedAt: NOW.toISOString(),
    ...extra,
  }
}

/** A provider that answers from fields the test sets. */
export interface FakeProvider extends AiProvider {
  detection: ProviderDetection
  /** Used instead of `detection` when set. */
  detectWith: (() => ProviderDetection) | null
  /** The next detect() waits for this before it answers. */
  detectGate: Promise<void> | null
  detectCalls: number
  /** The signal of the last detect(). */
  detectSignal: AbortSignal | null
  disconnectCalls: number
  options: ModelOption[]
  signInSignal: AbortSignal | null
  /** Ends the running connect() with a detection or an error. */
  finishSignIn(result: ProviderDetection | Error): void
}

export function fakeProvider(id: ProviderId, state: ProviderState): FakeProvider {
  let settle: ((result: ProviderDetection | Error) => void) | null = null
  const fake: FakeProvider = {
    id,
    detection: detectionFor(id, state),
    detectWith: null,
    detectGate: null,
    detectCalls: 0,
    detectSignal: null,
    disconnectCalls: 0,
    options: [
      { id: `${id}-large`, label: 'Large', supportsImages: true, isDefault: false },
      { id: `${id}-default`, label: 'Default', supportsImages: true, isDefault: true },
    ],
    signInSignal: null,
    async detect(signal) {
      fake.detectCalls += 1
      fake.detectSignal = signal ?? null
      const result = fake.detectWith ? fake.detectWith() : fake.detection
      const held = fake.detectGate
      fake.detectGate = null
      if (held) await held
      return result
    },
    models: () => Promise.resolve(fake.options),
    analyze: () => Promise.reject(new Error('The fakes run no analysis')),
    connect(signal) {
      fake.signInSignal = signal
      return new Promise<ProviderDetection>((resolve, reject) => {
        const abort = () => reject(new AppError('cancelled', 'Sign-in aborted'))
        signal.addEventListener('abort', abort, { once: true })
        settle = (result) => (result instanceof Error ? reject(result) : resolve(result))
      })
    },
    finishSignIn(result) {
      settle?.(result)
    },
    disconnect() {
      fake.disconnectCalls += 1
      if (PROVIDER_KINDS[id] !== 'cli') fake.detection = detectionFor(id, 'signed_out')
      return Promise.resolve()
    },
    setApiKey(key) {
      fake.detection = detectionFor(id, 'ready', { accountLabel: `…${key.slice(-4)}` })
      return Promise.resolve(fake.detection)
    },
  }
  return fake
}

export interface Harness {
  db: AppDatabase
  service: ProviderService
  providers: Record<ProviderId, FakeProvider>
  /** The context the service gave the provider factory. */
  context: ProviderContext
  /** Every providers:changed payload, oldest first. */
  changes: ProviderStatus[][]
  /** What the file dialog returns next. */
  nextFile: string | null
  close(): void
}

export interface HarnessOptions {
  offline?: boolean
  states?: Partial<Record<ProviderId, ProviderState>>
}

const DEFAULT_STATES: Record<ProviderId, ProviderState> = {
  chatgpt: 'signed_out',
  'claude-cli': 'ready',
  'codex-cli': 'not_installed',
  'openai-api': 'signed_out',
  'anthropic-api': 'signed_out',
}

// The fakes never touch the secret store, so it is never read or written.
const unusedEncryption: SecretEncryption = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('The fakes store no secrets')
  },
  decrypt: () => {
    throw new Error('The fakes store no secrets')
  },
}

/** A provider service over a migrated in-memory database and five fake providers. */
export function openHarness(options: HarnessOptions = {}): Harness {
  const db = openDatabase(':memory:')
  const states = { ...DEFAULT_STATES, ...options.states }
  const providers = byProvider((id) => fakeProvider(id, states[id]))
  const changes: ProviderStatus[][] = []
  const emit: EmitEvent = (event, payload) => {
    if (event === 'providers:changed') {
      changes.push(eventContract['providers:changed'].parse(payload))
    }
  }
  const captured: { context?: ProviderContext } = {}
  const service = createProviderService({
    db,
    emit,
    encryption: unusedEncryption,
    paths: { secrets: join(tmpdir(), 'edikte-provider-tests-unused', 'secrets.json') },
    openExternal: () => Promise.reject(new Error('The fakes open no browser')),
    chooseFile: () => Promise.resolve(harness.nextFile),
    offline: options.offline ?? false,
    now: () => NOW,
    createProviders: (context) => {
      captured.context = context
      return providers
    },
  })
  const { context } = captured
  if (context === undefined) throw new Error('The service did not build its providers')
  const harness: Harness = {
    db,
    service,
    providers,
    context,
    changes,
    nextFile: null,
    close: () => {
      service.dispose()
      db.$client.close()
    },
  }
  return harness
}

function byProvider<T>(make: (id: ProviderId) => T): Record<ProviderId, T> {
  return {
    chatgpt: make('chatgpt'),
    'claude-cli': make('claude-cli'),
    'codex-cli': make('codex-cli'),
    'openai-api': make('openai-api'),
    'anthropic-api': make('anthropic-api'),
  }
}

export function statusIn(statuses: readonly ProviderStatus[], id: ProviderId): ProviderStatus {
  const status = statuses.find((candidate) => candidate.id === id)
  if (status === undefined) throw new Error(`No status for ${id}`)
  return status
}

export function stateOf(harness: Harness, id: ProviderId): ProviderState {
  return statusIn(harness.service.list(), id).state
}

/** The AppError code the call fails with, or "resolved". */
export async function failureCode(run: () => unknown): Promise<string> {
  try {
    await run()
  } catch (error) {
    return isAppError(error) ? error.code : 'not an AppError'
  }
  return 'resolved'
}

/** Lets pending promise callbacks run. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** A promise the test resolves by hand. */
export function gate(): { promise: Promise<void>; release: () => void } {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
