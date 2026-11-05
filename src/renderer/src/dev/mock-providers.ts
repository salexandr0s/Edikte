import { AppError } from '@shared/errors'
import {
  PROVIDER_KINDS,
  type ModelOption,
  type ProviderId,
  type ProviderStatus,
} from '@shared/providers'
import { delay, type Emit, type MockHandlers, type MockState } from './mock-core'

// AI providers for the mock bridge. A sign-in finishes on its own after a
// short wait, as if the user had confirmed it in the browser. An API key that
// contains "invalid" is rejected. Every value is made up.

const SIGN_IN_MS = 2500

export function createProviderHandlers(state: MockState, emit: Emit): MockHandlers {
  const signIns = new Map<ProviderId, ReturnType<typeof setTimeout>>()

  const find = (provider: ProviderId): ProviderStatus => {
    const status = state.providers.find((candidate) => candidate.id === provider)
    if (status === undefined) throw new AppError('not_found', `Unknown provider ${provider}`)
    return status
  }

  const update = (provider: ProviderId, changes: Partial<ProviderStatus>): ProviderStatus => {
    const next = { ...find(provider), ...changes, checkedAt: new Date().toISOString() }
    state.providers = state.providers.map((status) => (status.id === provider ? next : status))
    if (!next.selected && state.settings.selectedProvider === provider) {
      state.settings = { ...state.settings, selectedProvider: null }
    }
    emit('providers:changed', state.providers)
    return next
  }

  const stopSignIn = (provider: ProviderId) => {
    clearTimeout(signIns.get(provider))
    signIns.delete(provider)
  }

  return {
    'providers:list': () => state.providers,
    'providers:detect': async () => {
      await delay(800)
      const checkedAt = new Date().toISOString()
      state.providers = state.providers.map((status) => ({ ...status, checkedAt }))
      emit('providers:changed', state.providers)
      return state.providers
    },

    'providers:connect': ({ provider }) => {
      const status = find(provider)
      if (PROVIDER_KINDS[provider] === 'api_key') {
        throw new AppError('invalid_request', 'API-key providers connect with providers:setApiKey')
      }
      if (status.state === 'not_installed') {
        throw new AppError('cli_not_found', `${provider} is not installed`)
      }
      if (status.state === 'ready' || status.state === 'signing_in') return status
      signIns.set(
        provider,
        setTimeout(() => {
          signIns.delete(provider)
          update(provider, {
            state: 'ready',
            accountLabel: 'you@example.com',
            plan: provider === 'chatgpt' ? 'Plus' : 'Pro',
            detail: null,
          })
        }, SIGN_IN_MS),
      )
      return update(provider, { state: 'signing_in', detail: null })
    },
    'providers:cancelConnect': ({ provider }) => {
      stopSignIn(provider)
      const status = find(provider)
      return status.state === 'signing_in' ? update(provider, { state: 'signed_out' }) : status
    },
    'providers:disconnect': ({ provider }) => {
      stopSignIn(provider)
      // A CLI keeps its own sign-in; the app only stops using it.
      if (PROVIDER_KINDS[provider] === 'cli') return update(provider, { selected: false })
      return update(provider, {
        state: 'signed_out',
        accountLabel: null,
        plan: null,
        selected: false,
      })
    },
    'providers:setApiKey': async ({ provider, key }) => {
      await delay(600)
      if (key.includes('invalid')) {
        throw new AppError('provider_auth', 'The provider rejected the key')
      }
      return update(provider, {
        state: 'ready',
        accountLabel: `…${key.slice(-4)}`,
        plan: null,
        detail: null,
      })
    },

    'providers:models': ({ provider }) => {
      if (PROVIDER_KINDS[provider] !== 'cli' && find(provider).state !== 'ready') {
        throw new AppError('provider_not_connected', `${provider} is not connected`)
      }
      return fakeModels(provider)
    },
    'providers:select': ({ provider }) => {
      if (provider !== null && find(provider).state !== 'ready') {
        throw new AppError('provider_not_connected', `${provider} is not ready`)
      }
      state.providers = state.providers.map((status) => ({
        ...status,
        selected: status.id === provider,
      }))
      state.settings = { ...state.settings, selectedProvider: provider }
      emit('providers:changed', state.providers)
      return state.providers
    },
    'providers:setModel': ({ provider, model }) => {
      const models = { ...state.settings.models }
      if (model === null) delete models[provider]
      else models[provider] = model
      state.settings = { ...state.settings, models }
      return update(provider, { model })
    },

    // Stands in for the file dialog in main: the user picked a binary.
    'providers:chooseCliPath': ({ provider }) => {
      const binaryPath = `/Users/example/bin/${provider === 'claude-cli' ? 'claude' : 'codex'}`
      const status = find(provider)
      state.settings = {
        ...state.settings,
        cliPaths: { ...state.settings.cliPaths, [provider]: binaryPath },
      }
      return update(provider, {
        binaryPath,
        binaryPathSource: 'override',
        version: status.version ?? '0.130.0',
        state: status.state === 'not_installed' ? 'signed_out' : status.state,
      })
    },
    'providers:resetCliPath': ({ provider }) => {
      const cliPaths = { ...state.settings.cliPaths }
      delete cliPaths[provider]
      state.settings = { ...state.settings, cliPaths }
      const {
        binaryPath,
        binaryPathSource,
        version,
        state: providerState,
      } = fakeProviderStatus(provider, null)
      if (providerState === 'not_installed') {
        return update(provider, {
          state: providerState,
          binaryPath,
          binaryPathSource,
          version,
          accountLabel: null,
          plan: null,
          selected: false,
        })
      }
      return update(provider, { binaryPath, binaryPathSource, version })
    },
  }
}

export function fakeProviderStatus(id: ProviderId, checkedAt: string | null): ProviderStatus {
  const base: ProviderStatus = {
    id,
    state: 'signed_out',
    version: null,
    binaryPath: null,
    binaryPathSource: null,
    accountLabel: null,
    plan: null,
    detail: null,
    selected: false,
    model: null,
    checkedAt,
  }
  switch (id) {
    case 'claude-cli':
      return {
        ...base,
        state: 'ready',
        version: '2.1.226',
        binaryPath: '/Users/example/.local/bin/claude',
        binaryPathSource: 'known_location',
        accountLabel: 'you@example.com',
        plan: 'Max',
      }
    case 'codex-cli':
      return { ...base, state: 'not_installed' }
    default:
      return base
  }
}

function fakeModels(provider: ProviderId): ModelOption[] {
  const option = (id: string, label: string, isDefault = false): ModelOption => ({
    id,
    label,
    supportsImages: true,
    isDefault,
  })
  switch (provider) {
    case 'claude-cli':
      return [
        option('default', 'Default', true),
        option('opus', 'Opus'),
        option('sonnet', 'Sonnet'),
        option('haiku', 'Haiku'),
      ]
    case 'codex-cli':
      return [option('default', 'Default', true)]
    case 'anthropic-api':
      return [
        option('claude-opus-5-5', 'Claude Opus 5.5', true),
        option('claude-sonnet-5-5', 'Claude Sonnet 5.5'),
        option('claude-haiku-5-5', 'Claude Haiku 5.5'),
      ]
    case 'chatgpt':
    case 'openai-api':
      return [option('mock-large', 'Large model', true), option('mock-small', 'Small model')]
  }
}
