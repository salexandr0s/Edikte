import { describe, expect, it } from 'vitest'
import { createOpenAiKeyProvider } from '../../../src/main/ai/api/openai-key'
import {
  MODELS_URL,
  RESPONSES_URL,
  buildResponsesBody,
  httpError,
  responsesHeaders,
  runResponses,
} from '../../../src/main/ai/api/responses-engine'
import {
  SseDecoder,
  SseLimitError,
  type SseEvent,
  type SseLimits,
} from '../../../src/main/ai/api/sse'
import { CHATGPT_ENDPOINTS } from '../../../src/main/ai/chatgpt/authorization'
import { createChatGptProvider } from '../../../src/main/ai/chatgpt/chatgpt-provider'
import type { AnalysisRequest } from '../../../src/main/ai/provider'
import type { SecretStore } from '../../../src/main/secure/secret-store'
import {
  bodyOf,
  fakeFetch,
  json,
  memorySecretStore,
  only,
  saveChatGptSignIn,
  splitEvery,
  sseFrames,
  streamResponse,
  type Route,
} from './helpers'

const NOW = Date.UTC(2026, 10, 4, 12)
const KEY = 'sk-test-0123456789abcdef'
const ANSWER = '{"ok":true}'
const LIMITS: SseLimits = { maxBytes: 1 << 20, maxEventBytes: 1 << 16, maxEvents: 100 }
const REQUEST: AnalysisRequest = {
  model: 'gpt-5.4',
  system: 'Extract the facts.',
  content: [
    { type: 'text', text: 'Gutachten text' },
    { type: 'image', mediaType: 'image/jpeg', data: Buffer.from('jpeg-bytes'), page: 3 },
  ],
  jsonSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  },
  schemaName: 'gutachten',
  maxOutputTokens: 4000,
}

function message(text: string) {
  return { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }
}

function completed(output: unknown[]) {
  return {
    type: 'response.completed',
    response: {
      model: 'gpt-5.4-2026-03-05',
      status: 'completed',
      output,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    },
  }
}

function run(response: Response) {
  const { fetch } = fakeFetch({ [`POST ${RESPONSES_URL}`]: () => response })
  return runResponses({
    provider: 'openai-api',
    fetch,
    headers: responsesHeaders(KEY),
    body: buildResponsesBody(REQUEST, { maxOutputTokens: true }),
    signal: new AbortController().signal,
  })
}

function decodeAll(bytes: Uint8Array, size: number, limits = LIMITS): SseEvent[] {
  const decoder = new SseDecoder(limits)
  const events: SseEvent[] = []
  for (let index = 0; index < bytes.length; index += size) {
    events.push(...decoder.push(bytes.subarray(index, index + size)))
  }
  events.push(...decoder.end())
  return events
}

describe('SSE decoder', () => {
  const text =
    '﻿: keep-alive\r\nevent: first\r\ndata: {"a":"Grünfläche 100 €"}\r\n\r\n' +
    'data: line 1\ndata:line 2\n\nevent: last\rdata: x\r\r: comment\ndata: unfinished'

  it.each([1, 2, 3, 5, 512])('decodes the stream split every %i bytes', (size) => {
    expect(decodeAll(new TextEncoder().encode(text), size)).toEqual([
      { event: 'first', data: '{"a":"Grünfläche 100 €"}' },
      { event: 'message', data: 'line 1\nline 2' },
      { event: 'last', data: 'x' },
    ])
  })

  it('stops at the size and count limits', () => {
    const encode = (value: string) => new TextEncoder().encode(value)
    const limited = (value: string, limits: Partial<SseLimits>) => () =>
      decodeAll(encode(value), 64, { ...LIMITS, ...limits })

    expect(limited('data: 1\n\ndata: 2\n\ndata: 3\n\n', { maxEvents: 2 })).toThrow(SseLimitError)
    expect(limited(`data: ${'x'.repeat(100)}\n\n`, { maxEventBytes: 50 })).toThrow(SseLimitError)
    expect(limited('data: 1\n\n'.repeat(20), { maxBytes: 100 })).toThrow(SseLimitError)
  })
})

describe('Responses stream', () => {
  it('assembles the answer from finished items when the completed event has no output', async () => {
    const secrets = memorySecretStore()
    await secrets.update((all) => ({ ...all, apiKeys: { ...all.apiKeys, openai: KEY } }))
    const frames = sseFrames([
      { type: 'response.created', response: { status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning' } },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning' } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'message' } },
      { type: 'response.output_text.delta', output_index: 1, delta: '{"ok":' },
      { type: 'response.output_text.delta', output_index: 1, delta: 'true}' },
      { type: 'response.output_item.done', output_index: 1, item: message(ANSWER) },
      completed([]),
    ])
    const { fetch, requests } = fakeFetch({
      [`POST ${RESPONSES_URL}`]: () => streamResponse(splitEvery(frames, 5)),
    })
    const openai = createOpenAiKeyProvider({ secrets, fetch, now: () => NOW })
    const progress: unknown[] = []

    const result = await openai.analyze(REQUEST, new AbortController().signal, (event) =>
      progress.push(event),
    )

    expect(result).toEqual({
      json: { ok: true },
      raw: ANSWER,
      model: 'gpt-5.4-2026-03-05',
      usage: { inputTokens: 10, outputTokens: 5, costUsd: null },
      accountLabel: '…cdef',
    })
    expect(progress).toEqual([{ phase: 'waiting' }, { phase: 'streaming', outputTokens: 1 }])
    const sent = only(requests)
    expect(sent.headers).toEqual({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    })
    expect(bodyOf(sent)).toEqual({
      model: 'gpt-5.4',
      instructions: 'Extract the facts.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Gutachten text' },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'gutachten',
          strict: true,
          schema: REQUEST.jsonSchema,
        },
      },
      store: false,
      stream: true,
      max_output_tokens: 4000,
    })
  })

  it.each([
    [
      'a failed response',
      sseFrames([{ type: 'response.failed', response: { error: { code: 'server_error' } } }]),
      'provider_unavailable',
    ],
    [
      'a context window overflow',
      sseFrames([
        { type: 'response.failed', response: { error: { code: 'context_length_exceeded' } } },
      ]),
      'document_too_large',
    ],
    [
      'a quota error event',
      sseFrames([{ type: 'error', code: 'insufficient_quota', message: 'quota' }]),
      'provider_billing',
    ],
    [
      'a plan usage limit',
      sseFrames([{ type: 'error', error: { code: 'usage_limit_reached' } }]),
      'provider_rate_limit',
    ],
    [
      'an answer cut off at the token limit',
      sseFrames([
        {
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'max_output_tokens' } },
        },
      ]),
      'provider_incomplete',
    ],
    [
      'a content filter stop',
      sseFrames([
        {
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'content_filter' } },
        },
      ]),
      'provider_refused',
    ],
    [
      'a refusal',
      sseFrames([completed([{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }])]),
      'provider_refused',
    ],
    [
      'text that is not JSON',
      sseFrames([completed([message('Here it is')])]),
      'provider_invalid_output',
    ],
    [
      'an item that never finished',
      sseFrames([
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message' } },
        completed([]),
      ]),
      'provider_invalid_output',
    ],
    [
      'a stream that ends without completion',
      sseFrames([{ type: 'response.output_text.delta', delta: '{' }]),
      'provider_incomplete',
    ],
    ['a [DONE] marker', 'data: [DONE]\n\n', 'provider_invalid_output'],
    [
      'an event name that contradicts the type',
      'event: response.completed\ndata: {"type":"response.failed"}\n\n',
      'provider_invalid_output',
    ],
  ])('maps %s', async (_case, stream, code) => {
    await expect(run(streamResponse([stream]))).rejects.toMatchObject({ code })
  })

  it.each([
    [
      'an incomplete response',
      {
        type: 'response.incomplete',
        response: {
          incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
      'provider_incomplete',
    ],
    ['text that is not JSON', completed([message('Here it is')]), 'provider_invalid_output'],
  ])('keeps the tokens used by %s on the error', async (_case, event, code) => {
    await expect(run(streamResponse([sseFrames([event])]))).rejects.toMatchObject({
      code,
      usage: { inputTokens: 10, outputTokens: 5, costUsd: null },
    })
  })

  it('rejects an answer that is not an event stream', async () => {
    await expect(run(json({ output: [] }))).rejects.toMatchObject({
      code: 'provider_invalid_output',
    })
  })

  it.each([
    [401, '{"error":{"code":"invalid_api_key","message":"Incorrect key sk-abc"}}', 'provider_auth'],
    [
      429,
      '{"error":{"code":"insufficient_quota","type":"insufficient_quota"}}',
      'provider_billing',
    ],
    [429, '{"error":{"type":"requests","message":"sk-abc"}}', 'provider_rate_limit'],
    [403, '{"detail":{"code":"chatpass_v2_scope_not_authorized"}}', 'provider_auth'],
    [429, '{"detail":{"code":"usage_limit_reached"}}', 'provider_rate_limit'],
    [400, '{"error":{"code":"context_length_exceeded"}}', 'document_too_large'],
    [400, '{"error":{"code":"constructor"}}', 'invalid_request'],
    [402, '', 'provider_billing'],
    [503, '<html>upstream sk-abc</html>', 'provider_unavailable'],
  ])('maps HTTP %i with body %s', (status, body, code) => {
    const error = httpError('chatgpt', status, body)
    expect(error.code).toBe(code)
    expect(error.message).not.toContain('sk-abc')
  })
})

describe('ChatGPT route', () => {
  async function signedIn(routes: (secrets: SecretStore) => Record<string, Route>) {
    const secrets = memorySecretStore()
    await saveChatGptSignIn(secrets, { expiresAt: NOW + 3_600_000 })
    const { fetch, requests } = fakeFetch(routes(secrets))
    const provider = createChatGptProvider({
      secrets,
      fetch,
      now: () => NOW,
      openExternal: () => Promise.reject(new Error('no browser in tests')),
    })
    return { provider, requests }
  }

  it('sends only the bearer token and leaves out max_output_tokens', async () => {
    const { provider, requests } = await signedIn(() => ({
      [`POST ${RESPONSES_URL}`]: () => streamResponse([sseFrames([completed([message(ANSWER)])])]),
    }))

    const result = await provider.analyze(REQUEST, new AbortController().signal)

    expect(result).toMatchObject({
      json: { ok: true },
      accountLabel: 'max@example.com',
      usage: { inputTokens: 10, outputTokens: 5, costUsd: null },
    })
    const sent = only(requests)
    expect(Object.keys(sent.headers).sort()).toEqual(['accept', 'authorization', 'content-type'])
    expect(sent.headers.authorization).toBe('Bearer access-1')
    expect(bodyOf(sent)).not.toHaveProperty('max_output_tokens')
  })

  it('fails when the account changes during the analysis', async () => {
    const { provider } = await signedIn((secrets) => ({
      [`POST ${RESPONSES_URL}`]: async () => {
        await saveChatGptSignIn(secrets, { expiresAt: NOW + 3_600_000, subject: 'user-2' })
        return streamResponse([sseFrames([completed([message(ANSWER)])])])
      },
    }))

    await expect(provider.analyze(REQUEST, new AbortController().signal)).rejects.toMatchObject({
      code: 'provider_account_changed',
    })
  })

  const renewed = () =>
    json({
      access_token: 'access-2',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-2',
    })

  it('renews a refused token once and repeats the request', async () => {
    let calls = 0
    const { provider, requests } = await signedIn(() => ({
      [`POST ${RESPONSES_URL}`]: () => {
        calls += 1
        return calls === 1
          ? json({ error: { code: 'token_expired' } }, 401)
          : streamResponse([sseFrames([completed([message(ANSWER)])])])
      },
      [`POST ${CHATGPT_ENDPOINTS.token}`]: renewed,
    }))

    await expect(provider.analyze(REQUEST, new AbortController().signal)).resolves.toMatchObject({
      json: { ok: true },
    })
    const sent = requests.filter((request) => request.url === RESPONSES_URL)
    expect(sent.map((request) => request.headers.authorization)).toEqual([
      'Bearer access-1',
      'Bearer access-2',
    ])
  })

  it('signs out when the renewed token is refused too', async () => {
    const { provider, requests } = await signedIn(() => ({
      [`POST ${RESPONSES_URL}`]: () => json({ error: { code: 'invalid_token' } }, 401),
      [`POST ${CHATGPT_ENDPOINTS.token}`]: renewed,
      [`POST ${CHATGPT_ENDPOINTS.revoke}`]: () => new Response(null, { status: 200 }),
    }))

    await expect(provider.analyze(REQUEST, new AbortController().signal)).rejects.toMatchObject({
      code: 'provider_auth',
    })
    expect(await provider.detect()).toMatchObject({ state: 'signed_out' })
    const revoked = requests
      .filter((request) => request.url === CHATGPT_ENDPOINTS.revoke)
      .map((request) => new URLSearchParams(request.body).get('token'))
    expect(revoked).toEqual(['refresh-2'])
  })

  it('lists the listed plan models once each, the first as default', async () => {
    const { provider, requests } = await signedIn(() => ({
      [`GET ${MODELS_URL}`]: () =>
        json({
          models: [
            { slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list' },
            { slug: 'gpt-internal', display_name: 'Internal', visibility: 'hide' },
            { slug: 'gpt-5.4-mini', display_name: null, visibility: 'list' },
            { slug: 'gpt-5.4', display_name: 'GPT-5.4 again', visibility: 'list' },
          ],
        }),
    }))

    expect(await provider.models()).toEqual([
      { id: 'gpt-5.4', label: 'GPT-5.4', supportsImages: true, isDefault: true },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', supportsImages: true, isDefault: false },
    ])
    expect(only(requests).headers).toEqual({ authorization: 'Bearer access-1' })
  })
})

describe('OpenAI API key', () => {
  it('checks a key against the model list before saving it', async () => {
    const secrets = memorySecretStore()
    let accept = false
    const { fetch, requests } = fakeFetch({
      [`GET ${MODELS_URL}`]: () =>
        accept
          ? json({
              data: [
                'dall-e-3',
                'gpt-4o-2024-05-13',
                'gpt-4o-2024-08-06',
                'gpt-5.4-2026-03-05',
                'gpt-5.4',
                'text-embedding-3-large',
                'gpt-5.2',
                'gpt-5.4',
              ].map((id) => ({ id, object: 'model' })),
            })
          : json({ error: { code: 'invalid_api_key' } }, 401),
    })
    const openai = createOpenAiKeyProvider({ secrets, fetch, now: () => NOW })

    await expect(openai.setApiKey?.(' sk-bad-0000 ')).rejects.toMatchObject({
      code: 'provider_auth',
    })
    expect((await secrets.read()).apiKeys.openai).toBeNull()

    accept = true
    await expect(openai.setApiKey?.(` ${KEY}\n`)).resolves.toMatchObject({
      state: 'ready',
      accountLabel: '…cdef',
    })
    expect(requests.at(-1)?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect((await secrets.read()).apiKeys.openai).toBe(KEY)

    // Only models with structured outputs; GPT-4o snapshots before 2024-08-06 lack them.
    expect(await openai.models()).toEqual([
      {
        id: 'gpt-4o-2024-08-06',
        label: 'gpt-4o-2024-08-06',
        supportsImages: true,
        isDefault: false,
      },
      { id: 'gpt-5.2', label: 'gpt-5.2', supportsImages: true, isDefault: false },
      { id: 'gpt-5.4', label: 'gpt-5.4', supportsImages: true, isDefault: true },
      {
        id: 'gpt-5.4-2026-03-05',
        label: 'gpt-5.4-2026-03-05',
        supportsImages: true,
        isDefault: false,
      },
    ])
  })
})
