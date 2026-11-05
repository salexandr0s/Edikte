import { z } from 'zod'

export const ProviderIdSchema = z.enum([
  'chatgpt',
  'claude-cli',
  'codex-cli',
  'openai-api',
  'anthropic-api',
])
export type ProviderId = z.infer<typeof ProviderIdSchema>
export const PROVIDER_IDS = ProviderIdSchema.options

export const CliProviderIdSchema = z.enum(['claude-cli', 'codex-cli'])
export type CliProviderId = z.infer<typeof CliProviderIdSchema>

export const ApiKeyProviderIdSchema = z.enum(['openai-api', 'anthropic-api'])
export type ApiKeyProviderId = z.infer<typeof ApiKeyProviderIdSchema>

export type ProviderKind = 'oauth' | 'cli' | 'api_key'

export const PROVIDER_KINDS: Readonly<Record<ProviderId, ProviderKind>> = {
  chatgpt: 'oauth',
  'claude-cli': 'cli',
  'codex-cli': 'cli',
  'openai-api': 'api_key',
  'anthropic-api': 'api_key',
}

/**
 * - ready: signed in and usable
 * - not_installed: CLI binary not found
 * - signed_out: installed or configured but no account
 * - signing_in: a sign-in flow started by the app is waiting for the browser
 * - update_required: CLI lacks a flag the app needs for an isolated run
 * - identity_only: ChatGPT sign-in without the scopes for model access
 * - error: detection failed; see `detail`
 */
export const ProviderStateSchema = z.enum([
  'ready',
  'not_installed',
  'signed_out',
  'signing_in',
  'update_required',
  'identity_only',
  'error',
])
export type ProviderState = z.infer<typeof ProviderStateSchema>

export const BinaryPathSourceSchema = z.enum(['override', 'known_location', 'path', 'login_shell'])

/** What the renderer may know about a provider. Never carries a token or key. */
export const ProviderStatusSchema = z.object({
  id: ProviderIdSchema,
  state: ProviderStateSchema,
  /** CLI version, when the provider is a CLI and it was found. */
  version: z.string().nullable(),
  binaryPath: z.string().nullable(),
  binaryPathSource: BinaryPathSourceSchema.nullable(),
  /** Email, account name or a masked key ending such as "…3f9a". */
  accountLabel: z.string().nullable(),
  plan: z.string().nullable(),
  /** Short technical detail for error states. */
  detail: z.string().nullable(),
  selected: z.boolean(),
  /** The model saved for this provider, if any. */
  model: z.string().nullable(),
  checkedAt: z.string().nullable(),
})
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>

export const ModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  supportsImages: z.boolean(),
  isDefault: z.boolean(),
})
export type ModelOption = z.infer<typeof ModelOptionSchema>
