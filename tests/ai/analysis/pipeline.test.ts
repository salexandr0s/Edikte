import { describe, expect, it, vi } from 'vitest'
import { ANALYSIS_SCHEMA_VERSION, type EvidenceItem } from '@shared/analysis-schema'
import { ANALYSIS_SCHEMA_NAME, analysisJsonSchema } from '../../../src/main/ai/analysis/json-schema'
import {
  AnalysisRunError,
  analysisFailure,
  runAnalysis,
  type AnalysisInput,
  type AnalysisStepEvent,
} from '../../../src/main/ai/analysis/pipeline'
import { PROMPT_VERSION, buildSystemPrompt } from '../../../src/main/ai/analysis/prompt'
import type { RenderPages } from '../../../src/main/ai/analysis/types'
import { ProviderError, type AiProvider, type AnalysisRequest } from '../../../src/main/ai/provider'
import { fakeProvider, houseAnswer, houseEdict, housePages } from './helpers'

const renderPages: RenderPages = (pages) =>
  Promise.resolve(pages.map((page) => ({ page, data: Buffer.from([0xff, 0xd8, page]) })))

function input(provider: AiProvider, overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    provider,
    model: 'test-model',
    imagesSupported: true,
    edict: houseEdict,
    pages: housePages,
    renderPages,
    ...overrides,
  }
}

function signal(): AbortSignal {
  return new AbortController().signal
}

function statusOf(evidence: readonly EvidenceItem[], path: string): string | undefined {
  return evidence.find((item) => item.path === path)?.status
}

function userText(request: AnalysisRequest | undefined): string {
  const part = request?.content[0]
  return part?.type === 'text' ? part.text : ''
}

describe('runAnalysis', () => {
  it('asks once, then checks the answer against the pages and the edict', async () => {
    const provider = fakeProvider('chatgpt', [
      {
        json: houseAnswer,
        raw: 'raw answer',
        model: 'test-model-2026',
        usage: { inputTokens: 40_000, outputTokens: 3_000 },
      },
    ])
    const events: AnalysisStepEvent[] = []
    const outcome = await runAnalysis(input(provider), signal(), (event) => events.push(event))

    expect(events.map((event) => event.step)).toEqual(['rendering', 'asking', 'checking'])
    const [request] = provider.requests
    expect(request?.system).toBe(buildSystemPrompt())
    expect(request?.schemaName).toBe(ANALYSIS_SCHEMA_NAME)
    expect(request?.jsonSchema).toEqual(analysisJsonSchema())
    expect(request?.content.map((part) => (part.type === 'image' ? part.page : part.type))).toEqual(
      ['text', 6, 12],
    )
    expect(outcome).toMatchObject({
      provider: 'chatgpt',
      model: 'test-model-2026',
      requestedModel: 'test-model',
      accountLabel: 'tester@example.com',
      promptVersion: PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      droppedPages: [],
      inputTokens: 40_000,
      outputTokens: 3_000,
      costUsd: null,
      rawResponse: 'raw answer',
      attempts: 1,
    })
    // The model listed page 99, which does not exist; both scans went as images.
    expect(outcome.result.unread_pages).toEqual([])
    expect(statusOf(outcome.evidence, 'defects.1')).toBe('scanned_page')
    expect(outcome.crossChecks.map((check) => check.kind)).toEqual([
      'area_vs_objektgroesse',
      'verkehrswert_vs_schaetzwert',
      'cellar_in_objektgroesse',
    ])
  })

  it('lists scans as unread when the model takes no images', async () => {
    const provider = fakeProvider('codex-cli', [{ json: houseAnswer }])
    const outcome = await runAnalysis(input(provider, { imagesSupported: false }), signal())
    expect(provider.requests[0]?.content).toHaveLength(1)
    expect(userText(provider.requests[0])).toContain(
      'Scanned pages without an image, which you cannot read beyond any text given for them above: 6, 12.',
    )
    expect(outcome.result.unread_pages).toEqual([6, 12])
    expect(statusOf(outcome.evidence, 'defects.1')).toBe('quote_not_found')
  })

  it('carries on without images when rendering fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const provider = fakeProvider('chatgpt', [{ json: houseAnswer }])
    const failing: RenderPages = () => Promise.reject(new Error('Raster window crashed'))
    const outcome = await runAnalysis(input(provider, { renderPages: failing }), signal())
    expect(provider.requests[0]?.content).toHaveLength(1)
    expect(outcome.result.unread_pages).toEqual([6, 12])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('retries once with the schema issues in a correction note', async () => {
    const invalid = { ...houseAnswer, areas: [{ ...houseAnswer.areas[0], sqm: -1 }] }
    const provider = fakeProvider('chatgpt', [
      { json: invalid, raw: 'first' },
      { json: houseAnswer, raw: 'second' },
    ])
    const outcome = await runAnalysis(input(provider), signal())
    expect(provider.requests).toHaveLength(2)
    expect(provider.requests[1]?.system).toMatch(/did not match the schema: areas\.0\.sqm: /)
    expect(outcome).toMatchObject({
      attempts: 2,
      inputTokens: 2_000,
      outputTokens: 400,
      rawResponse: '--- attempt 1 ---\nfirst\n\n--- attempt 2 ---\nsecond',
    })
  })

  it('retries once after text that is not JSON or a cut-off answer', async () => {
    const notJson = fakeProvider('chatgpt', [{ json: '{"areas": [' }, { json: houseAnswer }])
    await runAnalysis(input(notJson), signal())
    const cutOff = fakeProvider('chatgpt', [
      { error: new ProviderError('chatgpt', 'provider_incomplete', 'Output limit reached') },
      { json: houseAnswer },
    ])
    expect((await runAnalysis(input(cutOff), signal())).attempts).toBe(2)
    for (const provider of [notJson, cutOff]) {
      expect(provider.requests[1]?.system).toMatch(/was cut off or was not valid JSON/)
    }
  })

  it('gives up after a second invalid answer and keeps what both cost', async () => {
    const provider = fakeProvider('chatgpt', [
      { json: { areas: 'none' }, raw: 'first' },
      { json: { areas: 'none' }, raw: 'second' },
    ])
    const error = await runAnalysis(input(provider), signal()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AnalysisRunError)
    expect(analysisFailure(error)).toEqual({
      error: {
        code: 'provider_invalid_output',
        message: 'The answer did not match the schema after 2 attempts',
      },
      rawResponse: '--- attempt 1 ---\nfirst\n\n--- attempt 2 ---\nsecond',
      inputTokens: 2_000,
      outputTokens: 400,
      costUsd: null,
    })
  })

  it('adds what failed attempts used to the usage of the run', async () => {
    const usage = { inputTokens: 5_000, outputTokens: 32_000, costUsd: 0.5 }
    const provider = fakeProvider('anthropic-api', [
      {
        error: new ProviderError('anthropic-api', 'provider_incomplete', 'Cut off (max_tokens)', {
          usage,
        }),
      },
      { json: houseAnswer, usage: { costUsd: 0.25 } },
    ])
    expect(await runAnalysis(input(provider), signal())).toMatchObject({
      attempts: 2,
      inputTokens: 6_000,
      outputTokens: 32_200,
      costUsd: 0.75,
    })
  })

  it('does not retry when the pages do not fit the context window', async () => {
    const usage = { inputTokens: 190_000, outputTokens: 10_000, costUsd: 0.7 }
    const provider = fakeProvider('anthropic-api', [
      {
        error: new ProviderError(
          'anthropic-api',
          'document_too_large',
          'The pages do not fit the context window (model_context_window_exceeded)',
          { usage },
        ),
      },
      { json: houseAnswer },
    ])
    const error = await runAnalysis(input(provider), signal()).catch((caught: unknown) => caught)
    expect(provider.requests).toHaveLength(1)
    expect(analysisFailure(error)).toMatchObject({
      error: { code: 'document_too_large' },
      inputTokens: 190_000,
      outputTokens: 10_000,
      costUsd: 0.7,
    })
  })

  it('does not retry other provider errors', async () => {
    const provider = fakeProvider('chatgpt', [
      { error: new ProviderError('chatgpt', 'provider_auth', 'Signed out') },
      { json: houseAnswer },
    ])
    await expect(runAnalysis(input(provider), signal())).rejects.toMatchObject({
      code: 'provider_auth',
      attempts: 1,
      rawResponse: null,
    })
    expect(provider.requests).toHaveLength(1)
  })

  it('fails when the account changes between attempts', async () => {
    const provider = fakeProvider('chatgpt', [
      { json: {}, accountLabel: 'first@example.com' },
      { json: houseAnswer, accountLabel: 'second@example.com' },
    ])
    await expect(runAnalysis(input(provider), signal())).rejects.toMatchObject({
      code: 'provider_account_changed',
      attempts: 2,
    })
  })

  it('stops without a retry when cancelled', async () => {
    const before = new AbortController()
    before.abort()
    const unused = fakeProvider('chatgpt', [])
    await expect(runAnalysis(input(unused), before.signal)).rejects.toMatchObject({
      code: 'cancelled',
    })
    expect(unused.requests).toHaveLength(0)

    const during = new AbortController()
    const provider = fakeProvider('chatgpt', [{ hang: true }, { json: houseAnswer }])
    const run = runAnalysis(input(provider), during.signal)
    await vi.waitFor(() => expect(provider.requests).toHaveLength(1))
    during.abort()
    await expect(run).rejects.toMatchObject({ code: 'cancelled' })
    expect(provider.requests).toHaveLength(1)
  })

  it('prices API-key runs from the table when the provider reports no cost', async () => {
    const provider = fakeProvider('anthropic-api', [
      { json: houseAnswer, usage: { inputTokens: 100_000, outputTokens: 5_000 } },
    ])
    const outcome = await runAnalysis(input(provider, { model: 'claude-opus-5-5' }), signal())
    expect(outcome.costUsd).toBe(0.5)

    const reported = fakeProvider('anthropic-api', [
      { json: houseAnswer, usage: { costUsd: 0.42 } },
    ])
    const withCost = await runAnalysis(input(reported, { model: 'claude-opus-5-5' }), signal())
    expect(withCost.costUsd).toBe(0.42)
  })

  it('refuses a document without text or images', async () => {
    const provider = fakeProvider('chatgpt', [])
    const scans = [{ pageNumber: 1, printedLabel: null, hasText: false, text: '' }]
    await expect(
      runAnalysis(input(provider, { pages: scans, imagesSupported: false }), signal()),
    ).rejects.toMatchObject({ code: 'document_unreadable' })
    expect(provider.requests).toHaveLength(0)
  })
})
