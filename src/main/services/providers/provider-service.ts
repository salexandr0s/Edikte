import { AppError, isAppError } from '@shared/errors'
import {
  PROVIDER_IDS,
  PROVIDER_KINDS,
  type ApiKeyProviderId,
  type CliProviderId,
  type ModelOption,
  type ProviderId,
  type ProviderStatus,
} from '@shared/providers'
import type { AiProvider, ProviderDetection } from '../../ai/provider'
import type { AppDatabase } from '../../db/client'
import { readSettings, updateSettings } from '../../db/settings-store'
import type { EmitEvent } from '../../ipc/events'
import { log } from '../../log'
import type { AppPaths } from '../../paths'
import { createSecretStore, type SecretEncryption } from '../../secure/secret-store'
import { createDefaultProviders, type ProviderContext, type ProviderSet } from './default-providers'
import { failedDetection, initialDetection, offlineDetection, toStatus } from './detections'

/** A CLI without a saved model runs with its own default. */
const CLI_DEFAULT_MODEL = 'default'

export interface ProviderServiceDeps {
  db: AppDatabase
  emit: EmitEvent
  /** Encrypts the secret file: safeStorage in the app. */
  encryption: SecretEncryption
  paths: Pick<AppPaths, 'secrets'>
  /** Opens the ChatGPT sign-in page in the system browser. */
  openExternal: (url: string) => Promise<void>
  /** The file dialog for a CLI binary. Resolves null when the user closes it. */
  chooseFile: (provider: CliProviderId) => Promise<string | null>
  /** Detection starts no CLI and sends no request (e2e runs). */
  offline: boolean
  now?: () => Date
  /** Builds the providers. Defaults to the five real routes; tests pass fakes. */
  createProviders?: (context: ProviderContext) => ProviderSet
}

/** What an analysis runs with. */
export interface ActiveProvider {
  provider: AiProvider
  model: string
  status: ProviderStatus
}

export interface ProviderService {
  /** Last known statuses; safe defaults before the first detection. */
  list(): ProviderStatus[]
  /** Checks all five providers and emits providers:changed. */
  detect(): Promise<ProviderStatus[]>
  /** Runs the provider's sign-in and resolves when it ends. */
  connect(id: ProviderId): Promise<ProviderStatus>
  /** Aborts a running sign-in, whose connect() then fails with `cancelled`. */
  cancelConnect(id: ProviderId): ProviderStatus
  /** A CLI stays signed in and is only deselected; the others lose the app's credentials. */
  disconnect(id: ProviderId): Promise<ProviderStatus>
  setApiKey(id: ApiKeyProviderId, key: string): Promise<ProviderStatus>
  models(id: ProviderId): Promise<ModelOption[]>
  select(id: ProviderId | null): ProviderStatus[]
  /** null goes back to the provider's default model. */
  setModel(id: ProviderId, model: string | null): ProviderStatus
  /** Fails with `cancelled` when the user closes the dialog. */
  chooseCliPath(id: CliProviderId): Promise<ProviderStatus>
  resetCliPath(id: CliProviderId): Promise<ProviderStatus>
  /**
   * The selected provider if it is ready, and the model to use. For the analysis
   * service; fails with `cancelled` once `signal` aborts.
   */
  active(signal?: AbortSignal): Promise<ActiveProvider>
  /** Calls `listener` with the new selection after it changed. Returns the unsubscribe function. */
  onSelectionChange(listener: SelectionListener): () => void
  /** Aborts running sign-ins and checks. Nothing is emitted afterwards. */
  dispose(): void
}

export type SelectionListener = (selected: ProviderId | null) => void

interface SignIn {
  controller: AbortController
  done: Promise<ProviderStatus>
}

type SignInOutcome = { ok: true; detection: ProviderDetection } | { ok: false; error: unknown }

/**
 * Owns the five AI providers: their last detection, selection, saved models,
 * CLI paths and sign-ins. Statuses never carry a token or key. Electron stays
 * out of this module; the app injects safeStorage, dialogs and the browser.
 */
export function createProviderService(deps: ProviderServiceDeps): ProviderService {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const secrets = createSecretStore({ file: deps.paths.secrets, encryption: deps.encryption })
  const providers = (deps.createProviders ?? createDefaultProviders)({
    secrets,
    openExternal: deps.openExternal,
    cliPath: (id) => readSettings(db).cliPaths[id] ?? null,
    now,
  })
  const detections = new Map<ProviderId, ProviderDetection>()
  // Every check and every change takes a ticket when it starts. A provider keeps the result
  // with the newest ticket, so a check that started before a change cannot undo it.
  const tickets = new Map<ProviderId, number>()
  let lastTicket = 0
  const signIns = new Map<ProviderId, SignIn>()
  const selectionListeners = new Set<SelectionListener>()
  // Every check and model list gets this signal, so dispose() stops the CLIs they started.
  const lifetime = new AbortController()
  let detecting: Promise<ProviderStatus[]> | null = null
  let detected = false
  let disposed = false

  const detectionOf = (id: ProviderId) => detections.get(id) ?? initialDetection(id)
  const statusOf = (id: ProviderId) => toStatus(detectionOf(id), readSettings(db))

  function list(): ProviderStatus[] {
    const settings = readSettings(db)
    return PROVIDER_IDS.map((id) => toStatus(detectionOf(id), settings))
  }

  const nextTicket = () => ++lastTicket

  function store(id: ProviderId, detection: ProviderDetection, ticket = nextTicket()): void {
    if (ticket <= (tickets.get(id) ?? 0)) return
    detections.set(id, detection)
    tickets.set(id, ticket)
  }

  function storeState(id: ProviderId, state: 'signing_in' | 'signed_out'): void {
    store(id, { ...detectionOf(id), state, detail: null, checkedAt: now().toISOString() })
  }

  function publish(): void {
    if (!disposed) deps.emit('providers:changed', list())
  }

  async function detectOne(id: ProviderId): Promise<ProviderDetection> {
    if (deps.offline && PROVIDER_KINDS[id] === 'cli') return offlineDetection(id, now())
    try {
      return await providers[id].detect(lifetime.signal)
    } catch (error) {
      if (!isAppError(error)) log.warn('providers', `${id} detection failed unexpectedly`)
      return failedDetection(id, error, now())
    }
  }

  /** Stores a fresh detection unless something newer is stored or a sign-in owns the state. */
  async function refresh(id: ProviderId): Promise<void> {
    const ticket = nextTicket()
    const detection = await detectOne(id)
    if (!signIns.has(id)) store(id, detection, ticket)
  }

  async function runDetection(): Promise<ProviderStatus[]> {
    await Promise.all(PROVIDER_IDS.map((id) => refresh(id)))
    detected = true
    publish()
    return list()
  }

  function detect(): Promise<ProviderStatus[]> {
    detecting ??= runDetection().finally(() => {
      detecting = null
    })
    return detecting
  }

  /** Saves the selection and tells the listeners when it changed. */
  function setSelected(id: ProviderId | null): void {
    if (readSettings(db).selectedProvider === id) return
    updateSettings(db, { selectedProvider: id })
    if (disposed) return
    for (const listener of selectionListeners) {
      try {
        listener(id)
      } catch (error) {
        log.error(
          'providers',
          'Selection listener failed',
          isAppError(error) ? error.code : undefined,
        )
      }
    }
  }

  function deselect(id: ProviderId): void {
    if (readSettings(db).selectedProvider === id) setSelected(null)
  }

  /** Aborts a running sign-in and shows the provider as signed out. */
  function stopSignIn(id: ProviderId): boolean {
    const running = signIns.get(id)
    if (!running) return false
    signIns.delete(id)
    running.controller.abort()
    storeState(id, 'signed_out')
    return true
  }

  async function finishSignIn(
    id: ProviderId,
    signIn: (signal: AbortSignal) => Promise<ProviderDetection>,
    controller: AbortController,
  ): Promise<ProviderStatus> {
    let outcome: SignInOutcome
    try {
      outcome = { ok: true, detection: await signIn(controller.signal) }
    } catch (error) {
      outcome = { ok: false, error }
    }
    // cancelConnect, disconnect or dispose already removed the sign-in and set the state.
    if (controller.signal.aborted)
      throw new AppError('cancelled', `The ${id} sign-in was cancelled`)
    signIns.delete(id)
    if (outcome.ok) {
      store(id, outcome.detection)
    } else {
      // Show what the provider reports now instead of "signing in".
      storeState(id, 'signed_out')
      await refresh(id)
    }
    publish()
    if (!outcome.ok) throw outcome.error
    return statusOf(id)
  }

  function connect(id: ProviderId): Promise<ProviderStatus> {
    const running = signIns.get(id)
    if (running) return running.done
    const startSignIn = providers[id].connect?.bind(providers[id])
    if (PROVIDER_KINDS[id] === 'api_key' || startSignIn === undefined) {
      return Promise.reject(new AppError('invalid_request', `${id} connects with an API key`))
    }
    const current = statusOf(id)
    if (current.state === 'not_installed') {
      return Promise.reject(new AppError('cli_not_found', `${id} is not installed`))
    }
    if (current.state === 'ready') return Promise.resolve(current)
    const controller = new AbortController()
    // Starts on the next microtask, so the sign-in is registered before it can settle.
    const done = Promise.resolve().then(() => finishSignIn(id, startSignIn, controller))
    signIns.set(id, { controller, done })
    storeState(id, 'signing_in')
    publish()
    return done
  }

  function cancelConnect(id: ProviderId): ProviderStatus {
    if (stopSignIn(id)) publish()
    return statusOf(id)
  }

  async function disconnect(id: ProviderId): Promise<ProviderStatus> {
    stopSignIn(id)
    try {
      await providers[id].disconnect?.()
      deselect(id)
      // A CLI keeps its own sign-in; the others have just lost their credentials.
      if (PROVIDER_KINDS[id] !== 'cli') await refresh(id)
    } finally {
      publish()
    }
    return statusOf(id)
  }

  async function setApiKey(id: ApiKeyProviderId, key: string): Promise<ProviderStatus> {
    const provider = providers[id]
    if (!provider.setApiKey) throw new AppError('invalid_request', `${id} takes no API key`)
    store(id, await provider.setApiKey(key, lifetime.signal))
    publish()
    return statusOf(id)
  }

  async function models(id: ProviderId): Promise<ModelOption[]> {
    if (PROVIDER_KINDS[id] !== 'cli' && detectionOf(id).state !== 'ready') throw notConnected(id)
    return await providers[id].models(lifetime.signal)
  }

  function select(id: ProviderId | null): ProviderStatus[] {
    if (id !== null && detectionOf(id).state !== 'ready') throw notConnected(id)
    setSelected(id)
    publish()
    return list()
  }

  function setModel(id: ProviderId, model: string | null): ProviderStatus {
    const saved = { ...readSettings(db).models }
    if (model === null) delete saved[id]
    else saved[id] = model
    updateSettings(db, { models: saved })
    publish()
    return statusOf(id)
  }

  async function chooseCliPath(id: CliProviderId): Promise<ProviderStatus> {
    const chosen = await deps.chooseFile(id)
    if (chosen === null) throw new AppError('cancelled', 'No file was chosen')
    const cliPaths = { ...readSettings(db).cliPaths }
    cliPaths[id] = chosen
    updateSettings(db, { cliPaths })
    return checkCliAgain(id)
  }

  async function resetCliPath(id: CliProviderId): Promise<ProviderStatus> {
    const cliPaths = { ...readSettings(db).cliPaths }
    delete cliPaths[id]
    updateSettings(db, { cliPaths })
    return checkCliAgain(id)
  }

  /** After a path change. A CLI that is no longer found cannot stay selected. */
  async function checkCliAgain(id: CliProviderId): Promise<ProviderStatus> {
    await refresh(id)
    if (detectionOf(id).state === 'not_installed') deselect(id)
    publish()
    return statusOf(id)
  }

  async function active(signal?: AbortSignal): Promise<ActiveProvider> {
    // The detection is shared: one caller's abort stops its wait, not the check.
    if (!detected) await untilAborted(detect(), signal)
    const settings = readSettings(db)
    const id = settings.selectedProvider
    if (id === null) throw new AppError('provider_not_selected', 'No AI provider is selected')
    const status = toStatus(detectionOf(id), settings)
    if (status.state !== 'ready') throw notConnected(id)
    const provider = providers[id]
    const listSignal =
      signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, signal])
    const model =
      status.model ??
      (PROVIDER_KINDS[id] === 'cli' ? CLI_DEFAULT_MODEL : await defaultModel(provider, listSignal))
    return { provider, model, status }
  }

  function onSelectionChange(listener: SelectionListener): () => void {
    selectionListeners.add(listener)
    return () => {
      selectionListeners.delete(listener)
    }
  }

  function dispose(): void {
    disposed = true
    lifetime.abort()
    for (const signIn of signIns.values()) signIn.controller.abort()
    signIns.clear()
    selectionListeners.clear()
  }

  return {
    list,
    detect,
    connect,
    cancelConnect,
    disconnect,
    setApiKey,
    models,
    select,
    setModel,
    chooseCliPath,
    resetCliPath,
    active,
    onSelectionChange,
    dispose,
  }
}

async function defaultModel(provider: AiProvider, signal: AbortSignal): Promise<string> {
  const options = await provider.models(signal)
  const option = options.find((candidate) => candidate.isDefault) ?? options[0]
  if (option === undefined) {
    throw new AppError('provider_unavailable', `${provider.id} lists no models`)
  }
  return option.id
}

/** Waits for `promise`, or fails with `cancelled` as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new AppError('cancelled', 'Cancelled'))
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
      .catch(() => undefined)
  })
}

function notConnected(id: ProviderId): AppError {
  return new AppError('provider_not_connected', `${id} is not connected`)
}
