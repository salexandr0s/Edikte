import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { ModelOption } from '@shared/providers'
import type { SecretStore } from '../../secure/secret-store'
import { ProviderError, type AiProvider } from '../provider'
import {
  detection,
  maskKey,
  parseJson,
  readBody,
  transportError,
  withTimeout,
  type Fetch,
} from './common'
import {
  MODELS_URL,
  buildResponsesBody,
  httpError,
  responsesHeaders,
  runResponses,
} from './responses-engine'

const PROVIDER = 'openai-api'
const MAX_MODELS_BYTES = 8 * 1024 * 1024
const MODELS_TIMEOUT_MS = 30_000

const ModelListSchema = z.object({ data: z.array(z.object({ id: z.string().min(1) })).max(5000) })

const STRUCTURED_OUTPUT_BASES = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5.1',
  'gpt-5.2',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-6-sol',
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6-luna',
])
/** The first GPT-4o snapshot with structured outputs. */
const FIRST_STRUCTURED_GPT_4O = '2024-08-06'
const DEFAULT_PREFERENCE = ['gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o']

/**
 * True for models that take images and `json_schema` output with `strict: true`
 * on the Responses API. /v1/models also lists audio, image, embedding and
 * legacy models and reports no capabilities, so this is an allowlist of model
 * bases plus their dated snapshots (`<base>-YYYY-MM-DD`). GPT-4o snapshots
 * before 2024-08-06 lack structured outputs.
 */
export function supportsStructuredOutputs(id: string): boolean {
  if (STRUCTURED_OUTPUT_BASES.has(id)) return true
  const match = /^(.+)-(\d{4}-\d{2}-\d{2})$/.exec(id)
  const base = match?.[1]
  const date = match?.[2]
  if (base === undefined || date === undefined || !STRUCTURED_OUTPUT_BASES.has(base)) return false
  return base !== 'gpt-4o' || date >= FIRST_STRUCTURED_GPT_4O
}

export interface OpenAiKeyProviderDeps {
  secrets: SecretStore
  fetch?: Fetch
  now?: () => number
}

/** The user's OpenAI API key; analyses bill to that key's organization. */
export function createOpenAiKeyProvider(deps: OpenAiKeyProviderDeps): AiProvider {
  const fetchFn = deps.fetch ?? fetch
  const now = deps.now ?? Date.now

  async function storedKey(): Promise<string> {
    const key = (await deps.secrets.read()).apiKeys.openai
    if (key === null) {
      throw new ProviderError(PROVIDER, 'provider_not_connected', 'No OpenAI API key is saved')
    }
    return key
  }

  return {
    id: PROVIDER,
    async detect() {
      try {
        const key = (await deps.secrets.read()).apiKeys.openai
        return key === null
          ? detection(PROVIDER, 'signed_out', now())
          : detection(PROVIDER, 'ready', now(), { accountLabel: maskKey(key) })
      } catch (error) {
        return detection(PROVIDER, 'error', now(), {
          detail: error instanceof AppError ? error.message : 'The saved key could not be read',
        })
      }
    },
    async models(signal) {
      return toModelOptions(await listModelIds(fetchFn, await storedKey(), signal))
    },
    async analyze(request, signal, onProgress) {
      const key = await storedKey()
      const result = await runResponses({
        provider: PROVIDER,
        fetch: fetchFn,
        headers: responsesHeaders(key),
        body: buildResponsesBody(request, { maxOutputTokens: true }),
        signal,
        onProgress,
      })
      if ((await deps.secrets.read()).apiKeys.openai !== key) {
        throw new ProviderError(
          PROVIDER,
          'provider_account_changed',
          'The OpenAI API key changed during the analysis',
        )
      }
      return { ...result, accountLabel: maskKey(key) }
    },
    async setApiKey(key, signal) {
      const trimmed = key.trim()
      if (!deps.secrets.canWrite()) {
        throw new ProviderError(
          PROVIDER,
          'storage_unavailable',
          'The system offers no encryption for saved secrets',
        )
      }
      // Listing models proves the key works before it is saved.
      await listModelIds(fetchFn, trimmed, signal)
      await deps.secrets.update((secrets) => ({
        ...secrets,
        apiKeys: { ...secrets.apiKeys, openai: trimmed },
      }))
      return detection(PROVIDER, 'ready', now(), { accountLabel: maskKey(trimmed) })
    },
    async disconnect() {
      await deps.secrets.update((secrets) => ({
        ...secrets,
        apiKeys: { ...secrets.apiKeys, openai: null },
      }))
    },
  }
}

async function listModelIds(
  fetchFn: Fetch,
  key: string,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  let status: number
  let text: string
  try {
    const response = await fetchFn(MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: 'manual',
      signal: withTimeout(signal, MODELS_TIMEOUT_MS),
    })
    status = response.status
    text = await readBody(response, MAX_MODELS_BYTES)
  } catch (error) {
    throw transportError(PROVIDER, error, signal, 'The model list request')
  }
  if (status < 200 || status >= 300) throw httpError(PROVIDER, status, text)
  const parsed = ModelListSchema.safeParse(parseJson(text))
  if (!parsed.success) {
    throw new ProviderError(PROVIDER, 'provider_invalid_output', 'Unexpected model list')
  }
  return parsed.data.data.map((model) => model.id)
}

function toModelOptions(ids: string[]): ModelOption[] {
  const usable = [...new Set(ids.filter(supportsStructuredOutputs))].sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true }),
  )
  const preferred = DEFAULT_PREFERENCE.find((id) => usable.includes(id)) ?? usable[0]
  return usable.map((id) => ({ id, label: id, supportsImages: true, isDefault: id === preferred }))
}
