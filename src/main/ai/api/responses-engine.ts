import { z } from 'zod'
import type { AppErrorCode } from '@shared/errors'
import type { ProviderId } from '@shared/providers'
import {
  ProviderError,
  type AnalysisProgressHandler,
  type AnalysisRequest,
  type AnalysisUsage,
} from '../provider'
import {
  bodyStream,
  createProgress,
  parseJson,
  readBody,
  safeCode,
  transportError,
  withTimeout,
  type Fetch,
} from './common'
import { readSse, SseLimitError, type SseEvent } from './sse'

export const OPENAI_API_BASE = 'https://api.openai.com/v1'
export const RESPONSES_URL = `${OPENAI_API_BASE}/responses`
export const MODELS_URL = `${OPENAI_API_BASE}/models`

const RESPONSES_TIMEOUT_MS = 15 * 60_000
/**
 * Larger than ternmail's chat limits (2 MiB, 4096 events): an analysis streams
 * one event per token and repeats the whole answer in the closing events.
 */
const STREAM_LIMITS = {
  maxBytes: 32 * 1024 * 1024,
  maxEventBytes: 8 * 1024 * 1024,
  maxEvents: 200_000,
}
const MAX_ERROR_BODY_BYTES = 64 * 1024

export type ResponsesInputPart =
  { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }

export interface ResponsesBody {
  model: string
  instructions: string
  input: Array<{ role: 'user'; content: ResponsesInputPart[] }>
  text: {
    format: {
      type: 'json_schema'
      name: string
      strict: true
      schema: Record<string, unknown>
    }
  }
  store: false
  stream: true
  max_output_tokens?: number
}

export function buildResponsesBody(
  request: AnalysisRequest,
  options: { maxOutputTokens: boolean },
): ResponsesBody {
  const content = request.content.map((part): ResponsesInputPart =>
    part.type === 'text'
      ? { type: 'input_text', text: part.text }
      : {
          type: 'input_image',
          image_url: `data:${part.mediaType};base64,${part.data.toString('base64')}`,
        },
  )
  return {
    model: request.model,
    instructions: request.system,
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: request.schemaName,
        strict: true,
        schema: request.jsonSchema,
      },
    },
    store: false,
    stream: true,
    ...(options.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
  }
}

/** Exactly the headers of a streamed Responses call, nothing more. */
export function responsesHeaders(bearer: string): Record<string, string> {
  return {
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
}

export interface ResponsesCall {
  provider: ProviderId
  fetch: Fetch
  headers: Record<string, string>
  body: ResponsesBody
  signal: AbortSignal
  onProgress?: AnalysisProgressHandler
}

export interface ResponsesResult {
  json: unknown
  usage: AnalysisUsage
  model: string
  /** The answer text as streamed. */
  raw: string
}

/** POST /v1/responses with a streamed answer; the result comes from the closing events. */
export async function runResponses(call: ResponsesCall): Promise<ResponsesResult> {
  const { provider } = call
  const progress = createProgress(call.onProgress)
  progress.waiting()
  let response: Response
  try {
    response = await call.fetch(RESPONSES_URL, {
      method: 'POST',
      headers: call.headers,
      body: JSON.stringify(call.body),
      redirect: 'manual',
      signal: withTimeout(call.signal, RESPONSES_TIMEOUT_MS),
    })
  } catch (error) {
    throw transportError(provider, error, call.signal, 'The request')
  }
  if (!response.ok) {
    const text = await readBody(response, MAX_ERROR_BODY_BYTES).catch(() => '')
    throw httpError(provider, response.status, text)
  }
  const contentType = response.headers.get('content-type') ?? ''
  const body = bodyStream(response)
  if (!contentType.toLowerCase().startsWith('text/event-stream') || !body) {
    await body?.cancel().catch(() => undefined)
    throw new ProviderError(
      provider,
      'provider_invalid_output',
      'The answer was not an event stream',
    )
  }

  const stream = new ResponsesStream(provider, progress.delta)
  try {
    for await (const event of readSse(body, STREAM_LIMITS)) {
      const result = stream.handle(event)
      if (result) return { ...result, model: result.model ?? call.body.model }
    }
  } catch (error) {
    if (error instanceof SseLimitError) {
      throw new ProviderError(provider, 'provider_invalid_output', error.message)
    }
    throw transportError(provider, error, call.signal, 'The answer stream')
  }
  throw new ProviderError(
    provider,
    'provider_incomplete',
    'The answer stream ended before the response completed',
  )
}

const OutputItemSchema = z.looseObject({
  type: z.string(),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).optional(),
})
type OutputItem = z.infer<typeof OutputItemSchema>

const UsageSchema = z.looseObject({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
})

const ApiErrorSchema = z.looseObject({ code: z.string().nullish(), message: z.string().nullish() })

const ResponseObjectSchema = z.looseObject({
  model: z.string().optional(),
  status: z.string().optional(),
  output: z.array(OutputItemSchema).optional(),
  usage: UsageSchema.nullish(),
  error: ApiErrorSchema.nullish(),
  incomplete_details: z.looseObject({ reason: z.string().nullish() }).nullish(),
})

const EventSchema = z.looseObject({ type: z.string() })
const ItemEventSchema = z.looseObject({
  output_index: z.number().int().min(0),
  item: OutputItemSchema,
})
const TerminalEventSchema = z.looseObject({ response: ResponseObjectSchema })
const ErrorEventSchema = z.looseObject({
  code: z.string().nullish(),
  error: ApiErrorSchema.nullish(),
})

type StreamResult = Omit<ResponsesResult, 'model'> & { model: string | null }

class ResponsesStream {
  private readonly added = new Map<number, OutputItem>()
  private readonly done = new Map<number, OutputItem>()

  constructor(
    private readonly provider: ProviderId,
    private readonly onDelta: () => void,
  ) {}

  /** The result on `response.completed`; throws for failures; null otherwise. */
  handle(event: SseEvent): StreamResult | null {
    if (event.data === '[DONE]') throw this.invalid('unexpected [DONE] marker')
    const payload = parseJson(event.data)
    const base = EventSchema.safeParse(payload)
    if (!base.success) throw this.invalid('malformed event')
    const type = base.data.type
    if (event.event !== 'message' && event.event !== type) throw this.invalid('event name mismatch')

    switch (type) {
      case 'response.output_text.delta':
        this.onDelta()
        return null
      case 'response.output_item.added':
      case 'response.output_item.done': {
        const parsed = ItemEventSchema.safeParse(payload)
        if (!parsed.success) throw this.invalid('malformed output item')
        const target = type === 'response.output_item.added' ? this.added : this.done
        target.set(parsed.data.output_index, parsed.data.item)
        return null
      }
      case 'response.completed':
        return this.completed(payload)
      case 'response.incomplete': {
        const reason =
          TerminalEventSchema.safeParse(payload).data?.response.incomplete_details?.reason
        if (reason === 'content_filter') {
          throw new ProviderError(
            this.provider,
            'provider_refused',
            'A content filter stopped the answer',
          )
        }
        throw new ProviderError(
          this.provider,
          'provider_incomplete',
          `The answer is incomplete (${safeCode(reason) ?? 'no reason given'})`,
        )
      }
      case 'response.failed': {
        const code = TerminalEventSchema.safeParse(payload).data?.response.error?.code ?? null
        throw apiError(this.provider, code, 'provider_unavailable', 'The response failed')
      }
      case 'error': {
        const parsed = ErrorEventSchema.safeParse(payload).data
        const code = parsed?.code ?? parsed?.error?.code ?? null
        throw apiError(this.provider, code, 'provider_unavailable', 'The stream reported an error')
      }
      default:
        return null
    }
  }

  private completed(payload: unknown): StreamResult {
    const parsed = TerminalEventSchema.safeParse(payload)
    if (!parsed.success) throw this.invalid('malformed completion')
    const response = parsed.data.response
    if (response.status !== undefined && response.status !== 'completed') {
      throw new ProviderError(
        this.provider,
        'provider_incomplete',
        `The response ended as ${safeCode(response.status) ?? 'unknown'}`,
      )
    }
    const output = response.output?.length ? response.output : this.assembled()
    let text = ''
    for (const item of output) {
      if (item.type !== 'message') continue
      for (const part of item.content ?? []) {
        if (part.type === 'refusal') {
          throw new ProviderError(this.provider, 'provider_refused', 'The model declined to answer')
        }
        if (part.type === 'output_text') text += part.text ?? ''
      }
    }
    const json = text.trim() === '' ? undefined : parseJson(text)
    if (json === undefined) throw this.invalid('the answer is not JSON')
    return { json, raw: text, usage: toUsage(response.usage), model: response.model ?? null }
  }

  /** `response.completed` may carry an empty output; then the items come from the done events. */
  private assembled(): OutputItem[] {
    for (const index of this.added.keys()) {
      if (!this.done.has(index)) throw this.invalid('an output item never finished')
    }
    return [...this.done.entries()].sort(([a], [b]) => a - b).map(([, item]) => item)
  }

  private invalid(reason: string): ProviderError {
    return new ProviderError(
      this.provider,
      'provider_invalid_output',
      `Unexpected answer: ${reason}`,
    )
  }
}

function toUsage(usage: z.infer<typeof UsageSchema> | null | undefined): AnalysisUsage {
  if (!usage || usage.input_tokens + usage.output_tokens !== usage.total_tokens) {
    return { inputTokens: null, outputTokens: null, costUsd: null }
  }
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, costUsd: null }
}

/** OpenAI error codes, including the ChatGPT plan ones, mapped to app error codes. */
const ERROR_CODES: ReadonlyMap<string, AppErrorCode> = new Map([
  ['insufficient_quota', 'provider_billing'],
  ['insufficient_balance', 'provider_billing'],
  ['billing_hard_limit_reached', 'provider_billing'],
  ['rate_limit_exceeded', 'provider_rate_limit'],
  ['usage_limit_reached', 'provider_rate_limit'],
  ['subscription_sharing_usage_limit_exceeded', 'provider_rate_limit'],
  ['invalid_api_key', 'provider_auth'],
  ['invalid_token', 'provider_auth'],
  ['token_expired', 'provider_auth'],
  ['subscription_sharing_invalid_user', 'provider_auth'],
  ['user_not_eligible', 'provider_auth'],
  ['not_enabled', 'provider_auth'],
  ['chatpass_v2_scope_not_authorized', 'provider_auth'],
  ['chatpass_v2_invalid_authorization_context', 'provider_auth'],
  ['usage_unavailable', 'provider_unavailable'],
  ['user_unavailable', 'provider_unavailable'],
  ['server_error', 'provider_unavailable'],
  ['unsupported_capability', 'invalid_request'],
  ['route_not_supported', 'invalid_request'],
  ['context_length_exceeded', 'invalid_request'],
  ['invalid_prompt', 'provider_refused'],
])

/** Maps an error answer by its code, then by status. The body text is not copied. */
export function httpError(provider: ProviderId, status: number, body: string): ProviderError {
  const fallback: AppErrorCode =
    status === 401 || status === 403
      ? 'provider_auth'
      : status === 402
        ? 'provider_billing'
        : status === 429
          ? 'provider_rate_limit'
          : status === 400 || status === 413 || status === 422
            ? 'invalid_request'
            : 'provider_unavailable'
  return apiError(
    provider,
    errorBodyCode(parseJson(body)),
    fallback,
    `${serviceName(provider)} returned HTTP ${status}`,
  )
}

function apiError(
  provider: ProviderId,
  code: string | null,
  fallback: AppErrorCode,
  message: string,
): ProviderError {
  const safe = safeCode(code)
  const mapped = safe === null ? undefined : ERROR_CODES.get(safe)
  return new ProviderError(provider, mapped ?? fallback, safe ? `${message} (${safe})` : message)
}

/** `{error: {code, type}}` from the API, `{detail: {code}}` from ChatGPT plan admission. */
function errorBodyCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  if ('error' in body && typeof body.error === 'object' && body.error !== null) {
    const error = body.error
    const code = 'code' in error ? safeCode(error.code) : null
    return code ?? ('type' in error ? safeCode(error.type) : null)
  }
  if ('detail' in body && typeof body.detail === 'object' && body.detail !== null) {
    return 'code' in body.detail ? safeCode(body.detail.code) : null
  }
  return 'code' in body ? safeCode(body.code) : null
}

function serviceName(provider: ProviderId): string {
  return provider === 'chatgpt' ? 'ChatGPT' : 'The OpenAI API'
}
