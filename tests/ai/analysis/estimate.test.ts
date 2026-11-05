import { describe, expect, it } from 'vitest'
import { AnalysisEstimateSchema } from '@shared/domain'
import type { ApiKeyProviderId } from '@shared/providers'
import {
  OUTPUT_TOKENS_PER_ANALYSIS,
  TOKENS_PER_IMAGE,
  analysisCostUsd,
  buildAnalysisEstimate,
  estimateDocumentTokens,
  modelPrice,
  requestCostUsd,
  roundUsd,
  type AnalysisEstimateInput,
  type ModelPrice,
} from '../../../src/main/ai/analysis/estimate'
import { housePages } from './helpers'

function priceOf(provider: ApiKeyProviderId, model: string): ModelPrice {
  const price = modelPrice(provider, model)
  if (price === null) throw new Error(`No price for ${model}`)
  return price
}

describe('modelPrice', () => {
  it('prices API-key models, dated snapshots included, and nothing else', () => {
    expect(modelPrice('anthropic-api', 'claude-opus-5-5')).toEqual({
      inputPerMTok: 4,
      outputPerMTok: 20,
    })
    expect(modelPrice('openai-api', 'gpt-5-2025-08-07')).toEqual(priceOf('openai-api', 'gpt-5'))
    expect(modelPrice('openai-api', 'gpt-unknown')).toBeNull()
    expect(modelPrice('chatgpt', 'gpt-5')).toBeNull()
    expect(modelPrice('claude-cli', 'claude-opus-5-5')).toBeNull()
  })
})

describe('request costs', () => {
  it('switches to long-context prices above the threshold', () => {
    const haiku = priceOf('anthropic-api', 'claude-haiku-5-5')
    expect(requestCostUsd(haiku, 50_000, 10_000)).toBeCloseTo(0.01, 9)
    expect(requestCostUsd(haiku, 200_000, 10_000)).toBeCloseTo(0.125, 9)
  })

  it('needs both token counts', () => {
    const usage = { inputTokens: 100_000, outputTokens: 5_000 }
    expect(analysisCostUsd('anthropic-api', 'claude-opus-5-5', usage)).toBe(0.5)
    expect(
      analysisCostUsd('anthropic-api', 'claude-opus-5-5', { ...usage, inputTokens: null }),
    ).toBeNull()
  })
})

describe('buildAnalysisEstimate', () => {
  const input: AnalysisEstimateInput = {
    provider: 'anthropic-api',
    model: 'claude-opus-5-5',
    imagesSupported: true,
    listings: 5,
    alreadyAnalyzed: 2,
    withoutDocument: 1,
    downloadKb: 2_400,
    documents: [housePages, null],
  }

  it('adds up the documents and prices them for API keys only', () => {
    const known = estimateDocumentTokens(housePages, true)
    const unknown = estimateDocumentTokens(null, true)
    const price = priceOf('anthropic-api', 'claude-opus-5-5')
    const estimate = buildAnalysisEstimate(input)
    expect(AnalysisEstimateSchema.parse(estimate)).toEqual({
      listings: 5,
      alreadyAnalyzed: 2,
      withoutDocument: 1,
      downloadKb: 2_400,
      inputTokens: known.inputTokens + unknown.inputTokens,
      outputTokens: 2 * OUTPUT_TOKENS_PER_ANALYSIS,
      costUsd: roundUsd(
        requestCostUsd(price, known.inputTokens, known.outputTokens) +
          requestCostUsd(price, unknown.inputTokens, unknown.outputTokens),
      ),
      provider: 'anthropic-api',
      model: 'claude-opus-5-5',
    })
    expect(buildAnalysisEstimate({ ...input, provider: 'claude-cli' }).costUsd).toBeNull()
    expect(buildAnalysisEstimate({ ...input, provider: null, model: null })).toMatchObject({
      inputTokens: estimate.inputTokens,
      costUsd: null,
    })
  })

  it('counts page images only for models that accept them', () => {
    const withImages = estimateDocumentTokens(housePages, true).inputTokens
    const withoutImages = estimateDocumentTokens(housePages, false).inputTokens
    expect(withImages - withoutImages).toBe(2 * TOKENS_PER_IMAGE)
  })
})
