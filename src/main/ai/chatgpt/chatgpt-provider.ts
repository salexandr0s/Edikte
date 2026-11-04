import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { ModelOption } from '@shared/providers'
import { ProviderError, type AiProvider, type ProviderDetection } from '../provider'
import {
  detection,
  parseJson,
  readBody,
  transportError,
  withTimeout,
  type Fetch,
} from '../api/common'
import {
  MODELS_URL,
  buildResponsesBody,
  httpError,
  responsesHeaders,
  runResponses,
} from '../api/responses-engine'
import { ChatGptConnection, type ChatGptConnectionDeps } from './connection'

const ChatGptModelsSchema = z.object({
  models: z
    .array(
      z.object({
        slug: z.string().min(1),
        display_name: z.string().nullish(),
        visibility: z.string().nullish(),
      }),
    )
    .max(1000),
})
const MAX_MODELS_BYTES = 8 * 1024 * 1024
const MODELS_TIMEOUT_MS = 30_000

export type ChatGptProviderDeps = ChatGptConnectionDeps

/** Sign in with ChatGPT: model calls on the user's ChatGPT plan through the Responses API. */
export function createChatGptProvider(deps: ChatGptProviderDeps): AiProvider {
  const connection = new ChatGptConnection(deps)
  const fetchFn = deps.fetch ?? fetch
  const now = deps.now ?? Date.now

  async function detect(): Promise<ProviderDetection> {
    try {
      const status = await connection.status()
      return detection('chatgpt', status.state, now(), {
        accountLabel: status.accountLabel,
        detail: status.detail,
      })
    } catch (error) {
      return detection('chatgpt', 'error', now(), {
        detail: error instanceof AppError ? error.message : 'The saved sign-in could not be read',
      })
    }
  }

  return {
    id: 'chatgpt',
    detect,
    async models(signal) {
      const access = await connection.access()
      return listChatGptModels(fetchFn, access.accessToken, signal)
    },
    async analyze(request, signal, onProgress) {
      const access = await connection.access()
      const result = await runResponses({
        provider: 'chatgpt',
        fetch: fetchFn,
        headers: responsesHeaders(access.accessToken),
        // The ChatGPT route rejects max_output_tokens.
        body: buildResponsesBody(request, { maxOutputTokens: false }),
        signal,
        onProgress,
      })
      if ((await connection.currentSubject()) !== access.subject) {
        throw new ProviderError(
          'chatgpt',
          'provider_account_changed',
          'The ChatGPT account changed during the analysis',
        )
      }
      // Runs count against the ChatGPT plan, so there is no per-run price.
      return {
        ...result,
        usage: { ...result.usage, costUsd: null },
        accountLabel: access.accountLabel,
      }
    },
    async connect(signal) {
      await connection.signIn(signal)
      return detect()
    },
    disconnect: () => connection.disconnect(),
  }
}

/** Models the plan offers, in server order; only entries with visibility "list". */
async function listChatGptModels(
  fetchFn: Fetch,
  accessToken: string,
  signal: AbortSignal | undefined,
): Promise<ModelOption[]> {
  let status: number
  let text: string
  try {
    const response = await fetchFn(MODELS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'manual',
      signal: withTimeout(signal, MODELS_TIMEOUT_MS),
    })
    status = response.status
    text = await readBody(response, MAX_MODELS_BYTES)
  } catch (error) {
    throw transportError('chatgpt', error, signal, 'The model list request')
  }
  if (status < 200 || status >= 300) throw httpError('chatgpt', status, text)
  const parsed = ChatGptModelsSchema.safeParse(parseJson(text))
  if (!parsed.success) {
    throw new ProviderError('chatgpt', 'provider_invalid_output', 'Unexpected model list')
  }
  const seen = new Set<string>()
  const options: ModelOption[] = []
  for (const model of parsed.data.models) {
    if (model.visibility !== 'list' || seen.has(model.slug)) continue
    seen.add(model.slug)
    options.push({
      id: model.slug,
      label: model.display_name || model.slug,
      supportsImages: true,
      isDefault: options.length === 0,
    })
  }
  return options
}
