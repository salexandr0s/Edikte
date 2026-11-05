import { describe, expect, it } from 'vitest'
import { createAnthropicKeyProvider } from '../../../src/main/ai/api/anthropic-key'
import { ProviderError, type AnalysisRequest } from '../../../src/main/ai/provider'
import {
  bodyOf,
  fakeFetch,
  json,
  memorySecretStore,
  only,
  splitEvery,
  sseFrames,
  stalledResponse,
  streamResponse,
  type Route,
} from './helpers'

const API = 'https://api.anthropic.com/v1'
const KEY = 'sk-ant-test-0000wxyz'
const REQUEST: AnalysisRequest = {
  model: 'claude-opus-5-5',
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

function modelInfo(
  id: string,
  options: { adaptive?: boolean; structured?: boolean; lifecycle?: string } = {},
) {
  return {
    type: 'model',
    id,
    display_name: `Display ${id}`,
    created_at: '2026-01-01T00:00:00Z',
    lifecycle: options.lifecycle ?? 'active',
    capabilities: {
      image_input: { supported: true },
      structured_outputs: { supported: options.structured ?? true },
      thinking: {
        supported: true,
        types: { adaptive: { supported: options.adaptive ?? true }, enabled: { supported: true } },
      },
    },
  }
}

const MESSAGE_START = {
  type: 'message_start',
  message: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 1,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 30,
    },
  },
}

/** A streamed Messages answer as the API sends it, cut into small chunks. */
function messageStream(text: string, stopReason = 'end_turn'): Response {
  const half = Math.ceil(text.length / 2)
  const deltas = [text.slice(0, half), text.slice(half)].filter((part) => part !== '')
  const frames = sseFrames([
    MESSAGE_START,
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...deltas.map((part) => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: part },
    })),
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 50 },
    },
    { type: 'message_stop' },
  ])
  return streamResponse(splitEvery(frames, 7))
}

function apiError(status: number, type: string): Response {
  return json({ type: 'error', error: { type, message: 'secret detail' } }, status, {
    'x-should-retry': 'false',
    'request-id': 'req_123',
  })
}

/** Sends `text`, then fails the way undici reports a socket closed mid-body. */
function droppedResponse(text: string): Response {
  const socket = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  let sent = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) controller.error(new TypeError('terminated', { cause: socket }))
      else controller.enqueue(new TextEncoder().encode(text))
      sent = true
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

async function withKey(
  routes: Record<string, Route>,
  options: { analysisTimeoutMs?: number } = {},
) {
  const secrets = memorySecretStore()
  await secrets.update((all) => ({ ...all, apiKeys: { ...all.apiKeys, anthropic: KEY } }))
  const { fetch, requests } = fakeFetch(routes)
  return {
    anthropic: createAnthropicKeyProvider({ secrets, fetch, ...options }),
    secrets,
    requests,
  }
}

const signal = () => new AbortController().signal

describe('Anthropic API key', () => {
  it('sends one user turn with the schema, the page images and adaptive thinking', async () => {
    const { anthropic, requests } = await withKey({
      [`GET ${API}/models/claude-opus-5-5`]: () => json(modelInfo('claude-opus-5-5')),
      [`POST ${API}/messages`]: () => messageStream('{"ok":true}'),
    })
    const progress: unknown[] = []

    const result = await anthropic.analyze(REQUEST, signal(), (event) => progress.push(event))

    const sent = only(requests.filter((request) => request.method === 'POST'))
    // SDK 1.3.0 sends the key as a bearer token.
    expect(sent.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(sent.headers).not.toHaveProperty('x-api-key')
    const body = bodyOf(sent)
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      system: 'Extract the facts.',
      stream: true,
      thinking: { type: 'adaptive' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Gutachten text' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: Buffer.from('jpeg-bytes').toString('base64'),
              },
            },
          ],
        },
      ],
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    })
    expect(body).not.toHaveProperty('fallbacks')
    expect(result).toMatchObject({
      json: { ok: true },
      raw: '{"ok":true}',
      model: 'claude-opus-5-5',
      accountLabel: '…wxyz',
      usage: { inputTokens: 150, outputTokens: 50 },
    })
    // 100 input at $4, 20 cache writes at $5, 30 cache reads at $0.20, 50 output at $20 per million.
    expect(result.usage.costUsd).toBeCloseTo(0.001506, 9)
    expect(progress).toEqual([{ phase: 'waiting' }, { phase: 'streaming', outputTokens: 1 }])
  })

  it('leaves out adaptive thinking for models without it', async () => {
    const { anthropic, requests } = await withKey({
      [`GET ${API}/models/claude-older`]: () =>
        json(modelInfo('claude-older', { adaptive: false })),
      [`POST ${API}/messages`]: () => messageStream('{"ok":true}'),
    })

    await anthropic.analyze({ ...REQUEST, model: 'claude-older' }, signal())

    const sent = only(requests.filter((request) => request.method === 'POST'))
    expect(bodyOf(sent)).not.toHaveProperty('thinking')
  })

  it.each([
    ['refusal', 'provider_refused'],
    ['max_tokens', 'provider_incomplete'],
    ['model_context_window_exceeded', 'document_too_large'],
  ])('reports the stop reason %s as %s with the tokens it used', async (stopReason, code) => {
    const { anthropic } = await withKey({
      [`GET ${API}/models/claude-opus-5-5`]: () => json(modelInfo('claude-opus-5-5')),
      [`POST ${API}/messages`]: () => messageStream('{"ok":', stopReason),
    })

    const error: unknown = await anthropic.analyze(REQUEST, signal()).catch((e: unknown) => e)

    expect(error).toMatchObject({ code, usage: { inputTokens: 150, outputTokens: 50 } })
    expect(error instanceof ProviderError ? error.usage?.costUsd : null).toBeCloseTo(0.001506, 9)
  })

  it('reports a prompt over the context window as a document too large', async () => {
    const { anthropic } = await withKey({
      [`GET ${API}/models/claude-opus-5-5`]: () => json(modelInfo('claude-opus-5-5')),
      [`POST ${API}/messages`]: () =>
        json(
          {
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: 'prompt is too long: 213000 tokens > 200000 maximum',
            },
          },
          400,
          { 'x-should-retry': 'false', 'request-id': 'req_123' },
        ),
    })

    const error: unknown = await anthropic.analyze(REQUEST, signal()).catch((e: unknown) => e)

    expect(error).toMatchObject({ code: 'document_too_large' })
    expect(error instanceof Error ? error.message : '').not.toContain('213000')
  })

  it('ends a stream that stalls after the headers with a timeout', async () => {
    const { anthropic } = await withKey(
      {
        [`GET ${API}/models/claude-opus-5-5`]: () => json(modelInfo('claude-opus-5-5')),
        [`POST ${API}/messages`]: (_request, init) =>
          stalledResponse([sseFrames([MESSAGE_START])], init?.signal),
      },
      { analysisTimeoutMs: 100 },
    )

    await expect(anthropic.analyze(REQUEST, signal())).rejects.toMatchObject({ code: 'timeout' })
  })

  it.each([
    [
      'a connection dropped mid-stream',
      'network',
      () => droppedResponse(sseFrames([MESSAGE_START])),
    ],
    ['a stream without events', 'provider_incomplete', () => streamResponse([])],
    [
      'a stream that stops before message_stop',
      'provider_incomplete',
      () => streamResponse([sseFrames([MESSAGE_START])]),
    ],
  ])('maps %s to %s', async (_case, code, reply) => {
    const { anthropic } = await withKey({
      [`GET ${API}/models/claude-opus-5-5`]: () => json(modelInfo('claude-opus-5-5')),
      [`POST ${API}/messages`]: reply,
    })

    await expect(anthropic.analyze(REQUEST, signal())).rejects.toMatchObject({ code })
  })

  it('lists active models with structured outputs and marks Opus 5.5 as the default', async () => {
    const { anthropic } = await withKey({
      [`GET ${API}/models`]: () =>
        json({
          data: [
            modelInfo('claude-sonnet-5-5'),
            modelInfo('claude-opus-5-5'),
            modelInfo('claude-retired', { lifecycle: 'retired' }),
            modelInfo('claude-plain', { structured: false }),
            { id: 42 },
          ],
          has_more: false,
          first_id: 'claude-sonnet-5-5',
          last_id: 'claude-plain',
        }),
    })

    expect(await anthropic.models()).toEqual([
      {
        id: 'claude-sonnet-5-5',
        label: 'Display claude-sonnet-5-5',
        supportsImages: true,
        isDefault: false,
      },
      {
        id: 'claude-opus-5-5',
        label: 'Display claude-opus-5-5',
        supportsImages: true,
        isDefault: true,
      },
    ])
  })

  it('saves a key the API accepts', async () => {
    const secrets = memorySecretStore()
    const { fetch, requests } = fakeFetch({
      [`GET ${API}/models`]: () =>
        json({ data: [], has_more: false, first_id: null, last_id: null }),
    })
    const anthropic = createAnthropicKeyProvider({ secrets, fetch, now: () => 0 })

    await expect(anthropic.setApiKey?.(' sk-ant-new-1234\n')).resolves.toMatchObject({
      state: 'ready',
      accountLabel: '…1234',
    })
    expect(only(requests).headers.authorization).toBe('Bearer sk-ant-new-1234')
    expect((await secrets.read()).apiKeys.anthropic).toBe('sk-ant-new-1234')
  })

  it.each([
    [401, 'authentication_error', 'provider_auth'],
    [429, 'rate_limit_error', 'provider_rate_limit'],
    [529, 'overloaded_error', 'provider_unavailable'],
    [400, 'billing_error', 'provider_billing'],
  ])('maps HTTP %i %s to %s and saves nothing', async (status, type, code) => {
    const secrets = memorySecretStore()
    const { fetch } = fakeFetch({ [`GET ${API}/models`]: () => apiError(status, type) })
    const anthropic = createAnthropicKeyProvider({ secrets, fetch })

    const error: unknown = await anthropic.setApiKey?.('sk-ant-new-1234').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code })
    expect(error instanceof Error ? error.message : '').not.toContain('secret detail')
    expect((await secrets.read()).apiKeys.anthropic).toBeNull()
  })
})
