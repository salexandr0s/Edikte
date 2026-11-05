import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk'
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema'
import type {
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages'
import { z } from 'zod'
import { AppError, type AppErrorCode } from '@shared/errors'
import type { ModelOption } from '@shared/providers'
import type { SecretStore } from '../../secure/secret-store'
import {
  ProviderError,
  type AiProvider,
  type AnalysisRequest,
  type AnalysisResponse,
  type AnalysisUsage,
} from '../provider'
import {
  createProgress,
  detection,
  errorCode,
  maskKey,
  parseJson,
  safeCode,
  withTimeout,
  type Fetch,
} from './common'

const PROVIDER = 'anthropic-api'
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5'
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
const REQUEST_TIMEOUT_MS = 10 * 60_000
/**
 * Limit for a whole analysis. The SDK's timeout covers only the wait for the
 * response headers, so a stream that stalls afterwards would otherwise run
 * until the user cancels.
 */
const ANALYSIS_TIMEOUT_MS = 15 * 60_000
/** Ends the auto-paginating model list if the server never does. */
const MAX_MODELS = 1000

interface Price {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** USD per million tokens. Cache writes assume the 5-minute TTL (1.25 times input). */
const PRICES: ReadonlyMap<string, Price> = new Map([
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
])

interface Capabilities {
  adaptiveThinking: boolean
  images: boolean
  structuredOutputs: boolean
}

interface ModelSummary {
  id: string
  label: string
  retired: boolean
  capabilities: Capabilities
}

// The SDK returns the server's JSON without checking it; these schemas cover
// the fields the app reads.
const SupportSchema = z.object({ supported: z.boolean() }).nullish().catch(null)
const ModelInfoSchema = z.object({
  id: z.string().min(1).max(200),
  display_name: z.string().nullish(),
  lifecycle: z.string().nullish(),
  capabilities: z
    .object({
      image_input: SupportSchema,
      structured_outputs: SupportSchema,
      thinking: z
        .object({ types: z.object({ adaptive: SupportSchema }) })
        .nullish()
        .catch(null),
    })
    .nullish()
    .catch(null),
})
const UsageSchema = z.object({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cache_creation_input_tokens: z.number().int().min(0).nullish(),
  cache_read_input_tokens: z.number().int().min(0).nullish(),
})
type Usage = z.infer<typeof UsageSchema>
const MessageSchema = z.object({
  model: z.string().min(1),
  stop_reason: z.string().nullish(),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
  usage: UsageSchema.nullish().catch(null),
})

export interface AnthropicKeyProviderDeps {
  secrets: SecretStore
  /** Passed to the SDK client; tests inject a fake. */
  fetch?: Fetch
  now?: () => number
  /** Limit for a whole analysis; tests shorten it. */
  analysisTimeoutMs?: number
}

/** The user's Anthropic API key through the official SDK. */
export function createAnthropicKeyProvider(deps: AnthropicKeyProviderDeps): AiProvider {
  const now = deps.now ?? Date.now
  const capabilities = new Map<string, Capabilities>()

  async function storedKey(): Promise<string> {
    const key = (await deps.secrets.read()).apiKeys.anthropic
    if (key === null) {
      throw new ProviderError(PROVIDER, 'provider_not_connected', 'No Anthropic API key is saved')
    }
    return key
  }

  async function capabilitiesFor(
    client: Anthropic,
    model: string,
    signal: AbortSignal,
  ): Promise<Capabilities> {
    const known = capabilities.get(model)
    if (known) return known
    const summary = summarize(await client.models.retrieve(model, undefined, { signal }))
    if (summary === null) {
      throw new ProviderError(PROVIDER, 'provider_invalid_output', 'Unexpected model details')
    }
    capabilities.set(model, summary.capabilities)
    return summary.capabilities
  }

  return {
    id: PROVIDER,
    async detect() {
      try {
        const key = (await deps.secrets.read()).apiKeys.anthropic
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
      const client = createClient(await storedKey(), deps.fetch)
      const options: ModelOption[] = []
      let listed = 0
      try {
        for await (const info of client.models.list({ limit: 100 }, { signal })) {
          listed += 1
          if (listed > MAX_MODELS) break
          const summary = summarize(info)
          if (summary === null) continue
          capabilities.set(summary.id, summary.capabilities)
          if (summary.retired || !summary.capabilities.structuredOutputs) continue
          options.push({
            id: summary.id,
            label: summary.label,
            supportsImages: summary.capabilities.images,
            isDefault: summary.id === ANTHROPIC_DEFAULT_MODEL,
          })
        }
      } catch (error) {
        throw anthropicError(error, signal)
      }
      const [first] = options
      if (first && !options.some((option) => option.isDefault)) {
        options[0] = { ...first, isDefault: true }
      }
      return options
    },
    async analyze(request, signal, onProgress) {
      const key = await storedKey()
      const client = createClient(key, deps.fetch)
      const progress = createProgress(onProgress)
      progress.waiting()
      const deadline = withTimeout(signal, deps.analysisTimeoutMs ?? ANALYSIS_TIMEOUT_MS)
      let message: Message
      try {
        const found = await capabilitiesFor(client, request.model, deadline)
        const stream = client.messages.stream(buildMessageParams(request, found), {
          signal: deadline,
        })
        stream.on('streamEvent', (event) => {
          if (event.type === 'content_block_delta') progress.delta()
        })
        message = await stream.finalMessage()
      } catch (error) {
        throw anthropicError(error, signal, deadline)
      }
      if ((await deps.secrets.read()).apiKeys.anthropic !== key) {
        throw new ProviderError(
          PROVIDER,
          'provider_account_changed',
          'The Anthropic API key changed during the analysis',
        )
      }
      return toResponse(message, maskKey(key), request.model)
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
      try {
        // Listing models proves the key works before it is saved.
        await createClient(trimmed, deps.fetch).models.list({ limit: 1 }, { signal })
      } catch (error) {
        throw anthropicError(error, signal)
      }
      await deps.secrets.update((secrets) => ({
        ...secrets,
        apiKeys: { ...secrets.apiKeys, anthropic: trimmed },
      }))
      return detection(PROVIDER, 'ready', now(), { accountLabel: maskKey(trimmed) })
    },
    async disconnect() {
      await deps.secrets.update((secrets) => ({
        ...secrets,
        apiKeys: { ...secrets.apiKeys, anthropic: null },
      }))
    },
  }
}

function createClient(apiKey: string, fetchFn: Fetch | undefined): Anthropic {
  // A key and base URL passed here stop the SDK from taking either from
  // ANTHROPIC_* environment variables; logLevel, webhookKey and openTelemetry
  // likewise, so no variable can switch on tracing.
  return new Anthropic({
    apiKey,
    baseURL: ANTHROPIC_BASE_URL,
    webhookKey: null,
    logLevel: 'off',
    openTelemetry: false,
    fetch: fetchFn,
    maxRetries: 2,
    timeout: REQUEST_TIMEOUT_MS,
  })
}

/**
 * One user turn with the text and page images, the answer schema as
 * `output_config.format`, and adaptive thinking where the model has it. No
 * server-side fallback models: a run must use the model the user chose.
 */
export function buildMessageParams(
  request: AnalysisRequest,
  found: Pick<Capabilities, 'adaptiveThinking'>,
): MessageCreateParamsNonStreaming {
  const content = request.content.map((part): ContentBlockParam =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: part.mediaType,
            data: part.data.toString('base64'),
          },
        },
  )
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    system: request.system,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: anthropicSchema(request.jsonSchema) } },
    thinking: found.adaptiveThinking ? { type: 'adaptive' } : undefined,
  }
}

/** The SDK's transform moves constraints structured outputs reject into descriptions. */
function anthropicSchema(schema: Record<string, unknown>): Record<string, unknown> {
  let transformed: unknown
  try {
    transformed = transformJSONSchema(schema)
  } catch {
    transformed = null
  }
  if (typeof transformed !== 'object' || transformed === null || Array.isArray(transformed)) {
    throw new ProviderError(
      PROVIDER,
      'invalid_request',
      'The answer schema cannot be used with the Anthropic API',
    )
  }
  return { ...transformed }
}

function summarize(info: unknown): ModelSummary | null {
  const parsed = ModelInfoSchema.safeParse(info)
  if (!parsed.success) return null
  const { id, display_name: label, lifecycle, capabilities: found } = parsed.data
  return {
    id,
    label: label || id,
    retired: lifecycle === 'retired',
    capabilities: {
      adaptiveThinking: found?.thinking?.types.adaptive?.supported ?? false,
      images: found?.image_input?.supported ?? false,
      structuredOutputs: found?.structured_outputs?.supported ?? false,
    },
  }
}

function toResponse(
  message: unknown,
  accountLabel: string,
  requestedModel: string,
): AnalysisResponse {
  const parsed = MessageSchema.safeParse(message)
  if (!parsed.success) {
    throw new ProviderError(PROVIDER, 'provider_invalid_output', 'Unexpected answer: bad message')
  }
  const { model, stop_reason: stopReason, content, usage: reported } = parsed.data
  const price = PRICES.get(model) ?? PRICES.get(requestedModel) ?? null
  const usage = toUsage(reported ?? null, price)
  // A failed answer still used tokens; the error carries them for the run's totals.
  const spent = reported ? { usage } : undefined
  switch (stopReason) {
    case 'refusal':
      throw new ProviderError(PROVIDER, 'provider_refused', 'Claude declined to answer', spent)
    case 'max_tokens':
    case 'pause_turn':
      throw new ProviderError(
        PROVIDER,
        'provider_incomplete',
        `The answer is incomplete (${stopReason})`,
        spent,
      )
    case 'model_context_window_exceeded':
      throw new ProviderError(
        PROVIDER,
        'document_too_large',
        'The document does not fit the model context window',
        spent,
      )
    case null:
    case undefined:
      // Only a finished message has a stop reason.
      throw new ProviderError(
        PROVIDER,
        'provider_incomplete',
        'The answer stream ended early',
        spent,
      )
    default:
      break
  }
  const text = content.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('')
  const json = text.trim() === '' ? undefined : parseJson(text)
  if (json === undefined) {
    throw new ProviderError(
      PROVIDER,
      'provider_invalid_output',
      'Unexpected answer: not JSON',
      spent,
    )
  }
  return { json, usage, model, accountLabel, raw: text }
}

function toUsage(usage: Usage | null, price: Price | null): AnalysisUsage {
  if (usage === null) return { inputTokens: null, outputTokens: null, costUsd: null }
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  return {
    inputTokens: usage.input_tokens + cacheWrite + cacheRead,
    outputTokens: usage.output_tokens,
    costUsd: price
      ? (usage.input_tokens * price.input +
          cacheWrite * price.cacheWrite +
          cacheRead * price.cacheRead +
          usage.output_tokens * price.output) /
        1_000_000
      : null,
  }
}

/** MessageStream messages for a stream that ended before the answer did. */
const CUT_OFF_MESSAGES = [
  'stream ended without producing',
  'request ended without sending any chunks',
]

function anthropicError(
  error: unknown,
  signal: AbortSignal | undefined,
  deadline?: AbortSignal,
): ProviderError {
  if (error instanceof ProviderError) return error
  if (signal?.aborted) return new ProviderError(PROVIDER, 'cancelled', 'The request was cancelled')
  // The SDK reports an abort by the deadline as its own abort error.
  if (deadline?.aborted) {
    return new ProviderError(
      PROVIDER,
      'timeout',
      'The Anthropic API did not finish the answer in time',
    )
  }
  if (error instanceof APIUserAbortError) {
    return new ProviderError(PROVIDER, 'cancelled', 'The request was cancelled')
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new ProviderError(PROVIDER, 'timeout', 'The Anthropic API did not answer in time')
  }
  if (error instanceof APIConnectionError) {
    return new ProviderError(PROVIDER, 'network', 'The Anthropic API could not be reached')
  }
  if (error instanceof APIError) {
    // Errors inside a stream have no HTTP status.
    const status = typeof error.status === 'number' ? error.status : 0
    const type = safeCode(error.type)
    const requestId = safeCode(error.requestID)
    const what = status > 0 ? `returned HTTP ${status}` : 'reported an error'
    const code =
      status === 400 && promptTooLong(error.error)
        ? 'document_too_large'
        : errorCodeFor(status, type)
    return new ProviderError(
      PROVIDER,
      code,
      `The Anthropic API ${what}${type ? ` (${type})` : ''}${requestId ? `, request ${requestId}` : ''}`,
    )
  }
  // MessageStream rewraps any other error as a plain AnthropicError with the original as `cause`.
  if (
    error instanceof AnthropicError &&
    CUT_OFF_MESSAGES.some((text) => error.message.startsWith(text))
  ) {
    return new ProviderError(PROVIDER, 'provider_incomplete', 'The answer stream ended early')
  }
  if (connectionLost(error)) {
    return new ProviderError(PROVIDER, 'network', 'The connection to the Anthropic API was lost')
  }
  return new ProviderError(PROVIDER, 'internal', 'The Anthropic request failed')
}

/** A socket error code on the cause chain, or undici's "terminated" for a body cut off mid-stream. */
function connectionLost(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (current instanceof TypeError && current.message === 'terminated') return true
    current = current.cause
  }
  return errorCode(error) !== null
}

/** The API's 400 for a prompt over the context window: "prompt is too long: N tokens > M maximum". */
function promptTooLong(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false
  const detail = body.error
  return (
    typeof detail === 'object' &&
    detail !== null &&
    'message' in detail &&
    typeof detail.message === 'string' &&
    /prompt is too long/i.test(detail.message)
  )
}

function errorCodeFor(status: number, type: string | null): AppErrorCode {
  if (type === 'billing_error' || status === 402) return 'provider_billing'
  if (status === 401 || status === 403) return 'provider_auth'
  if (type === 'authentication_error' || type === 'permission_error') return 'provider_auth'
  if (status === 429 || type === 'rate_limit_error') return 'provider_rate_limit'
  if (status >= 500 || type === 'overloaded_error' || type === 'api_error') {
    return 'provider_unavailable'
  }
  if (status === 400 || status === 413) return 'invalid_request'
  return 'provider_unavailable'
}
