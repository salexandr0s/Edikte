import type { CliProviderId, ProviderId } from '@shared/providers'
import {
  createAnthropicKeyProvider,
  createChatGptProvider,
  createOpenAiKeyProvider,
} from '../../ai/api'
import { createClaudeCliProvider, createCodexCliProvider } from '../../ai/cli'
import type { AiProvider } from '../../ai/provider'
import type { SecretStore } from '../../secure/secret-store'

/** What the provider service hands to the factory that builds the providers. */
export interface ProviderContext {
  /** One store for the ChatGPT tokens and both API keys. */
  secrets: SecretStore
  /** Opens the ChatGPT sign-in page in the system browser. */
  openExternal: (url: string) => Promise<void>
  /** The binary chosen in Settings, or null to search. Read before every CLI run. */
  cliPath: (id: CliProviderId) => string | null
  now: () => Date
}

export type ProviderSet = Readonly<Record<ProviderId, AiProvider>>

/** The five real routes. Creating them starts no process and sends no request. */
export function createDefaultProviders(context: ProviderContext): ProviderSet {
  const { secrets, now } = context
  const nowMs = () => now().getTime()
  return {
    chatgpt: createChatGptProvider({ secrets, openExternal: context.openExternal, now: nowMs }),
    'claude-cli': createClaudeCliProvider({
      getOverridePath: () => context.cliPath('claude-cli'),
      now,
    }),
    'codex-cli': createCodexCliProvider({
      getOverridePath: () => context.cliPath('codex-cli'),
      now,
    }),
    'openai-api': createOpenAiKeyProvider({ secrets, now: nowMs }),
    'anthropic-api': createAnthropicKeyProvider({ secrets, now: nowMs }),
  }
}
