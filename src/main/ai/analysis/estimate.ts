import type { AnalysisEstimate } from '@shared/domain'
import { ApiKeyProviderIdSchema, type ApiKeyProviderId, type ProviderId } from '@shared/providers'
import type { AnalysisUsage } from '../provider'
import { analysisJsonSchema } from './json-schema'
import { planPages } from './page-plan'
import { buildSystemPrompt } from './prompt'
import type { AnalysisPage } from './types'

// Measured on a real analysis in November 2026: a Gutachten with 61,247
// characters of text and 3 page images took about 46,000 input tokens on
// Claude and 12,700 output tokens.
/** German report text, with its numbers and tables, runs at about 2 characters per token. */
export const CHARS_PER_TOKEN = 2
/** A 1,600 by 1,130 px page image costs width × height / 750 tokens on Claude, less on OpenAI. */
export const TOKENS_PER_IMAGE = 2_400
/** The JSON answer in two languages plus the reasoning tokens models bill as output. */
export const OUTPUT_TOKENS_PER_ANALYSIS = 13_000
// For a Gutachten not downloaded yet. The two sample reports had 25,000 and
// 62,000 characters of text and 8 and 2 scanned pages.
const UNKNOWN_DOCUMENT_CHARS = 60_000
const UNKNOWN_DOCUMENT_IMAGES = 6
// The <page pdf="12" printed="Seite 10"> and </page> lines around each page.
const PAGE_WRAPPER_CHARS = 40

/** USD per million tokens. */
export interface ModelPrice {
  inputPerMTok: number
  outputPerMTok: number
  /** Prices for requests whose input is above `aboveInputTokens`. */
  longContext?: { aboveInputTokens: number; inputPerMTok: number; outputPerMTok: number }
}

const OPENAI_LONG_CONTEXT = 272_000
const HAIKU_LONG_CONTEXT = 100_000

function price(
  inputPerMTok: number,
  outputPerMTok: number,
  long?: readonly [aboveInputTokens: number, inputPerMTok: number, outputPerMTok: number],
): ModelPrice {
  if (long === undefined) return { inputPerMTok, outputPerMTok }
  const [aboveInputTokens, longInput, longOutput] = long
  return {
    inputPerMTok,
    outputPerMTok,
    longContext: { aboveInputTokens, inputPerMTok: longInput, outputPerMTok: longOutput },
  }
}

// Standard-tier list prices, read from the official pricing pages on 2026-11-04:
// - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
// - OpenAI: https://developers.openai.com/api/docs/pricing (platform.openai.com/docs/pricing
//   redirects there). gpt-5.6-sol is listed at a promotional price until 2026-11-30.
// Update the table and the date together. Models missing here get no cost.
const PRICES: Readonly<Record<ApiKeyProviderId, ReadonlyMap<string, ModelPrice>>> = {
  'anthropic-api': new Map([
    ['claude-fable-5-1', price(10, 50)],
    ['claude-fable-5', price(10, 50)],
    ['claude-opus-5-5', price(4, 20)],
    ['claude-opus-5', price(5, 25)],
    ['claude-opus-4-8', price(5, 25)],
    ['claude-opus-4-7', price(5, 25)],
    ['claude-opus-4-6', price(5, 25)],
    ['claude-sonnet-5-5', price(2, 10)],
    ['claude-sonnet-5', price(2, 10)],
    ['claude-sonnet-4-6', price(3, 15)],
    ['claude-haiku-5-5', price(0.1, 0.5, [HAIKU_LONG_CONTEXT, 0.5, 2.5])],
    ['claude-haiku-4-5', price(1, 5)],
  ]),
  'openai-api': new Map([
    ['gpt-6-astra', price(10, 50, [OPENAI_LONG_CONTEXT, 20, 75])],
    ['gpt-6.1-sol', price(2, 10, [OPENAI_LONG_CONTEXT, 4, 15])],
    ['gpt-6.1-terra', price(1, 5, [OPENAI_LONG_CONTEXT, 2, 7.5])],
    ['gpt-6-sol', price(2, 10, [OPENAI_LONG_CONTEXT, 4, 15])],
    ['gpt-6-luna', price(0.1, 0.5, [OPENAI_LONG_CONTEXT, 0.2, 0.75])],
    ['gpt-5.6-sol', price(4, 20, [OPENAI_LONG_CONTEXT, 8, 30])],
    ['gpt-5.6-terra', price(2, 12, [OPENAI_LONG_CONTEXT, 4, 18])],
    ['gpt-5.6-luna', price(0.2, 1.2, [OPENAI_LONG_CONTEXT, 0.4, 1.8])],
    ['gpt-5.5', price(5, 30, [OPENAI_LONG_CONTEXT, 10, 45])],
    ['gpt-5.4', price(2.5, 15, [OPENAI_LONG_CONTEXT, 5, 22.5])],
    ['gpt-5.4-mini', price(0.75, 4.5)],
    ['gpt-5.4-nano', price(0.2, 1.25)],
    ['gpt-5.2', price(1.75, 14)],
    ['gpt-5.1', price(1.25, 10)],
    ['gpt-5', price(1.25, 10)],
    ['gpt-5-mini', price(0.25, 2)],
    ['gpt-5-nano', price(0.05, 0.4)],
    ['gpt-4.1', price(2, 8)],
    ['gpt-4.1-mini', price(0.4, 1.6)],
    ['gpt-4o', price(2.5, 10)],
    ['gpt-4o-mini', price(0.15, 0.6)],
  ]),
}

/** Price of a model on an API-key provider; null for subscriptions, CLIs and unknown models. */
export function modelPrice(provider: ProviderId, model: string): ModelPrice | null {
  const apiProvider = ApiKeyProviderIdSchema.safeParse(provider)
  if (!apiProvider.success) return null
  const table = PRICES[apiProvider.data]
  const id = model.trim().toLowerCase()
  // Dated snapshots such as gpt-5-2025-08-07 cost what their model costs.
  return table.get(id) ?? table.get(id.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, '')) ?? null
}

export function requestCostUsd(
  price: ModelPrice,
  inputTokens: number,
  outputTokens: number,
): number {
  const long = price.longContext
  const tier = long !== undefined && inputTokens > long.aboveInputTokens ? long : price
  return (inputTokens * tier.inputPerMTok + outputTokens * tier.outputPerMTok) / 1_000_000
}

/** Cost of one request from its token counts, for providers that report none. */
export function analysisCostUsd(
  provider: ProviderId,
  model: string,
  usage: Pick<AnalysisUsage, 'inputTokens' | 'outputTokens'>,
): number | null {
  const modelCost = modelPrice(provider, model)
  if (modelCost === null || usage.inputTokens === null || usage.outputTokens === null) return null
  return roundUsd(requestCostUsd(modelCost, usage.inputTokens, usage.outputTokens))
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/** Tokens for one analysis, from the pages the prompt would carry. Null pages: not downloaded yet. */
export function estimateDocumentTokens(
  pages: readonly AnalysisPage[] | null,
  imagesSupported: boolean,
): { inputTokens: number; outputTokens: number } {
  let chars = UNKNOWN_DOCUMENT_CHARS
  let images = imagesSupported ? UNKNOWN_DOCUMENT_IMAGES : 0
  if (pages !== null) {
    const plan = planPages(pages, { imagesSupported })
    chars = plan.textChars + plan.textPages.length * PAGE_WRAPPER_CHARS
    images = plan.imagePages.length
  }
  return {
    inputTokens:
      promptOverheadTokens() + Math.ceil(chars / CHARS_PER_TOKEN) + images * TOKENS_PER_IMAGE,
    outputTokens: OUTPUT_TOKENS_PER_ANALYSIS,
  }
}

export interface AnalysisEstimateInput {
  provider: ProviderId | null
  model: string | null
  /** From ModelOption.supportsImages. */
  imagesSupported: boolean
  listings: number
  alreadyAnalyzed: number
  withoutDocument: number
  downloadKb: number
  /** Pages of each Gutachten to analyse; null for one that is not downloaded yet. */
  documents: ReadonlyArray<readonly AnalysisPage[] | null>
}

/** The numbers "Analyze filtered" shows before it starts. */
export function buildAnalysisEstimate(input: AnalysisEstimateInput): AnalysisEstimate {
  const modelCost =
    input.provider === null || input.model === null ? null : modelPrice(input.provider, input.model)
  let inputTokens = 0
  let outputTokens = 0
  let cost = 0
  for (const pages of input.documents) {
    const tokens = estimateDocumentTokens(pages, input.imagesSupported)
    inputTokens += tokens.inputTokens
    outputTokens += tokens.outputTokens
    // Long-context prices depend on the size of each request, so price them one by one.
    if (modelCost !== null)
      cost += requestCostUsd(modelCost, tokens.inputTokens, tokens.outputTokens)
  }
  return {
    listings: input.listings,
    alreadyAnalyzed: input.alreadyAnalyzed,
    withoutDocument: input.withoutDocument,
    downloadKb: input.downloadKb,
    inputTokens,
    outputTokens,
    costUsd: modelCost === null ? null : roundUsd(cost),
    provider: input.provider,
    model: input.model,
  }
}

let overheadTokens: number | null = null

function promptOverheadTokens(): number {
  overheadTokens ??= Math.ceil(
    (buildSystemPrompt().length + JSON.stringify(analysisJsonSchema()).length) / CHARS_PER_TOKEN,
  )
  return overheadTokens
}
