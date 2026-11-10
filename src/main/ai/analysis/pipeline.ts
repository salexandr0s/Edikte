import {
  ANALYSIS_SCHEMA_VERSION,
  AnalysisResultSchema,
  type AnalysisResult,
  type CrossCheck,
  type EvidenceItem,
} from '@shared/analysis-schema'
import { AppError, isAppError, type AppErrorCode, type AppErrorShape } from '@shared/errors'
import type { ProviderId } from '@shared/providers'
import { log } from '../../log'
import {
  ProviderError,
  type AiProvider,
  type AnalysisRequest,
  type AnalysisResponse,
  type AnalysisUsage,
} from '../provider'
import { runCrossChecks } from './cross-checks'
import { analysisCostUsd, roundUsd } from './estimate'
import { checkEvidence } from './evidence'
import { ANALYSIS_SCHEMA_NAME, analysisJsonSchema } from './json-schema'
import { MAX_IMAGES, planPages } from './page-plan'
import { PROMPT_VERSIONS, buildContent, buildSystemPrompt, correctionNote } from './prompt'
import type { AnalysisPage, EdictFacts, RenderPages, RenderedPage } from './types'

/** Room for the JSON answer plus the reasoning tokens some models count as output. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000
/** Raw output kept for debugging; the analyses table notes that it may be truncated. */
export const RAW_RESPONSE_LIMIT = 1_000_000
const MAX_ATTEMPTS = 2
const MAX_REPORTED_ISSUES = 12

export interface AnalysisInput {
  /** Fixed for the whole run: there is no fallback to another provider. */
  provider: AiProvider
  /** Fixed for the whole run: there is no fallback to another model. */
  model: string
  /** From ModelOption.supportsImages. */
  imagesSupported: boolean
  edict: EdictFacts
  /** Every page of the Gutachten, from document_pages. */
  pages: readonly AnalysisPage[]
  /** Renders scanned pages to JPEG. Without it, scanned pages are listed as unread. */
  renderPages?: RenderPages | undefined
  maxOutputTokens?: number | undefined
}

/** Steps of a run; they match the steps of AnalysisProgress. */
export interface AnalysisStepEvent {
  step: 'rendering' | 'asking' | 'checking'
  attempt?: number
  outputTokens?: number
}

/** What the analyses table stores for a finished run. */
export interface AnalysisOutcome {
  provider: ProviderId
  /** The model the provider reports, or the requested one when it reports none. */
  model: string
  requestedModel: string
  accountLabel: string | null
  promptVersion: number
  schemaVersion: number
  result: AnalysisResult
  evidence: EvidenceItem[]
  crossChecks: CrossCheck[]
  droppedPages: number[]
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  rawResponse: string
  attempts: number
}

/** A run that failed after the provider was asked; carries what was spent and received. */
export class AnalysisRunError extends AppError {
  constructor(
    code: AppErrorCode,
    message: string,
    /** Provider output of every attempt, for the analyses table. */
    readonly rawResponse: string | null,
    readonly usage: AnalysisUsage,
    readonly attempts: number,
    options?: ErrorOptions,
  ) {
    super(code, message, options)
  }
}

/** What the analyses table stores for a failed run. */
export interface AnalysisFailure {
  error: AppErrorShape
  rawResponse: string | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
}

export function analysisFailure(error: unknown): AnalysisFailure {
  const appError = isAppError(error)
    ? error
    : new AppError(
        'internal',
        `Analysis failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      )
  const run = error instanceof AnalysisRunError ? error : null
  return {
    error: appError.toShape(),
    rawResponse: run?.rawResponse ?? null,
    inputTokens: run?.usage.inputTokens ?? null,
    outputTokens: run?.usage.outputTokens ?? null,
    costUsd: run?.usage.costUsd ?? null,
  }
}

export type ParsedAnswer = { ok: true; result: AnalysisResult } | { ok: false; issues: string[] }

/** Validates a provider answer. Issues name schema paths only, never document text. */
export function parseAnalysisAnswer(json: unknown): ParsedAnswer {
  const value = typeof json === 'string' ? parseJson(json) : json
  // Text that is not JSON was cut off or garbled: there is no schema path to name.
  if (value === undefined) return { ok: false, issues: [] }
  const parsed = AnalysisResultSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues
        .slice(0, MAX_REPORTED_ISSUES)
        .map((issue) => `${issue.path.map(String).join('.') || 'answer'}: ${issue.message}`),
    }
  }
  const result = parsed.data
  const issues = (['summary_de', 'summary_en'] as const)
    .filter((key) => result[key].trim() === '')
    .map((key) => `${key}: empty`)
  if (issues.length > 0) return { ok: false, issues }
  // A stray index is not worth a second run: the cross-checks fall back to the area kinds.
  const index = result.primary_area_index
  return {
    ok: true,
    result:
      index !== null && index >= result.areas.length
        ? { ...result, primary_area_index: null }
        : result,
  }
}

/**
 * Analyses one Gutachten: plans the pages, renders scans for models that
 * accept images, asks the provider (one retry with a correction note when the
 * answer is invalid or incomplete), then checks evidence and the edict values.
 */
export async function runAnalysis(
  input: AnalysisInput,
  signal: AbortSignal,
  onProgress?: (event: AnalysisStepEvent) => void,
): Promise<AnalysisOutcome> {
  const { provider, model, edict } = input
  const report = onProgress ?? (() => undefined)
  throwIfCancelled(signal)

  const render = input.imagesSupported ? input.renderPages : undefined
  const plan = planPages(input.pages, { imagesSupported: render !== undefined })
  let images: RenderedPage[] = []
  if (render !== undefined && plan.imagePages.length > 0) {
    report({ step: 'rendering' })
    images = await renderImages(render, plan.imagePages, signal)
  }
  const imagePages = images.map((image) => image.page)
  const unreadPages = uniqueSorted([
    ...plan.unreadPages,
    ...plan.imagePages.filter((page) => !imagePages.includes(page)),
  ])
  if (images.length === 0 && plan.textPages.length === 0) {
    throw new AppError('document_unreadable', 'The Gutachten has no page text or images to analyze')
  }

  const content = buildContent(
    edict,
    {
      pageCount: plan.pageCount,
      textPages: plan.textPages,
      unreadPages,
      droppedPages: plan.droppedPages,
    },
    images,
  )
  const { result, responses, usage, attempts } = await ask(
    provider,
    {
      model,
      content,
      jsonSchema: analysisJsonSchema(),
      schemaName: ANALYSIS_SCHEMA_NAME,
      maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    },
    edict.source,
    signal,
    report,
  )

  report({ step: 'checking' })
  const dropped = new Set(plan.droppedPages)
  const checked: AnalysisResult = {
    ...result,
    // Pages the app could not send are unread whatever the model says. Pages
    // dropped over the size limit are stored separately.
    unread_pages: uniqueSorted([
      ...result.unread_pages.filter((page) => page <= plan.pageCount && !dropped.has(page)),
      ...unreadPages,
    ]),
  }
  const last = responses.at(-1)
  const reportedModel = last?.model.trim() ?? ''
  return {
    provider: provider.id,
    model: reportedModel === '' ? model : reportedModel,
    requestedModel: model,
    accountLabel: last?.accountLabel ?? null,
    promptVersion: PROMPT_VERSIONS[edict.source],
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    result: checked,
    evidence: checkEvidence(checked, { pages: input.pages, imagePages }),
    crossChecks: runCrossChecks(checked, edict),
    droppedPages: plan.droppedPages,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    rawResponse: joinRaw(responses),
    attempts,
  }
}

interface Answer {
  result: AnalysisResult
  responses: AnalysisResponse[]
  /** Every attempt, failed requests that reported their usage included. */
  usage: AnalysisUsage
  attempts: number
}

/** What one request used, with the model it is priced by. */
interface Spend {
  model: string
  usage: AnalysisUsage
}

async function ask(
  provider: AiProvider,
  request: Omit<AnalysisRequest, 'system'>,
  source: EdictFacts['source'],
  signal: AbortSignal,
  report: (event: AnalysisStepEvent) => void,
): Promise<Answer> {
  const responses: AnalysisResponse[] = []
  const spent: Spend[] = []
  const fail = (error: AppError, attempt: number, cause?: unknown): AnalysisRunError =>
    new AnalysisRunError(
      error.code,
      error.message,
      responses.length === 0 ? null : joinRaw(responses),
      usageOf(provider.id, spent),
      attempt,
      { cause: cause ?? error },
    )
  let correction: string | null = null
  for (let attempt = 1; ; attempt += 1) {
    throwIfCancelled(signal)
    report({ step: 'asking', attempt })
    let response: AnalysisResponse
    try {
      response = await provider.analyze(
        { ...request, system: buildSystemPrompt(source, correction) },
        signal,
        (event) => report({ step: 'asking', attempt, outputTokens: event.outputTokens }),
      )
    } catch (error) {
      // A failed request can still be billed, e.g. an answer cut off at the output limit.
      if (error instanceof ProviderError && error.usage !== null) {
        spent.push({ model: request.model, usage: error.usage })
      }
      if (signal.aborted) throw cancelledError(error)
      if (attempt < MAX_ATTEMPTS && isRetryable(error)) {
        correction = correctionNote([])
        continue
      }
      throw fail(toAppError(error), attempt, error)
    }
    responses.push(response)
    spent.push({ model: response.model.trim() || request.model, usage: response.usage })
    if (accountChanged(responses)) {
      throw fail(
        new AppError('provider_account_changed', 'The provider account changed between attempts'),
        attempt,
      )
    }
    const parsed = parseAnalysisAnswer(response.json)
    if (parsed.ok) {
      const usage = usageOf(provider.id, spent)
      return { result: parsed.result, responses, usage, attempts: attempt }
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw fail(
        new AppError(
          'provider_invalid_output',
          `The answer did not match the schema after ${attempt} attempts`,
        ),
        attempt,
      )
    }
    correction = correctionNote(parsed.issues)
  }
}

async function renderImages(
  render: RenderPages,
  pages: readonly number[],
  signal: AbortSignal,
): Promise<RenderedPage[]> {
  try {
    const wanted = new Set(pages)
    const byPage = new Map<number, RenderedPage>()
    for (const image of await render(pages, signal)) {
      if (wanted.has(image.page) && image.data.length > 0 && !byPage.has(image.page)) {
        byPage.set(image.page, image)
      }
    }
    return [...byPage.values()].sort((a, b) => a.page - b.page).slice(0, MAX_IMAGES)
  } catch (error) {
    if (signal.aborted) throw cancelledError(error)
    // The text still gets analysed; the scans are listed as unread.
    log.warn(
      'analysis',
      'Rendering scanned pages failed',
      isAppError(error) ? error.code : undefined,
    )
    return []
  }
}

function usageOf(provider: ProviderId, spent: readonly Spend[]): AnalysisUsage {
  const reported = sumOrNull(spent.map(({ usage }) => usage.costUsd))
  return {
    inputTokens: sumOrNull(spent.map(({ usage }) => usage.inputTokens)),
    outputTokens: sumOrNull(spent.map(({ usage }) => usage.outputTokens)),
    costUsd: reported ?? computedCost(provider, spent),
  }
}

// API-key providers that report no cost get one from the price table.
function computedCost(provider: ProviderId, spent: readonly Spend[]): number | null {
  if (spent.length === 0) return null
  let total = 0
  for (const { model, usage } of spent) {
    const cost = analysisCostUsd(provider, model, usage)
    if (cost === null) return null
    total += cost
  }
  return roundUsd(total)
}

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  let total = 0
  for (const value of values) {
    if (value === null) return null
    total += value
  }
  return values.length === 0 ? null : total
}

function joinRaw(responses: readonly AnalysisResponse[]): string {
  const raw =
    responses.length === 1
      ? (responses[0]?.raw ?? '')
      : responses
          .map((response, index) => `--- attempt ${index + 1} ---\n${response.raw}`)
          .join('\n\n')
  return raw.length > RAW_RESPONSE_LIMIT ? `${raw.slice(0, RAW_RESPONSE_LIMIT)}\n[truncated]` : raw
}

function accountChanged(responses: readonly AnalysisResponse[]): boolean {
  const first = responses[0]?.accountLabel
  const last = responses.at(-1)?.accountLabel
  return first != null && last != null && first !== last
}

// Pages that do not fit the model's context window come as document_too_large,
// which is not retried: the same pages would fail again and cost as much.
function isRetryable(error: unknown): boolean {
  return (
    isAppError(error) &&
    (error.code === 'provider_invalid_output' || error.code === 'provider_incomplete')
  )
}

function toAppError(error: unknown): AppError {
  return isAppError(error)
    ? error
    : new AppError('internal', 'The provider failed unexpectedly', { cause: error })
}

function cancelledError(cause: unknown): AppError {
  return isAppError(cause) && cause.code === 'cancelled'
    ? cause
    : new AppError('cancelled', 'Analysis cancelled', { cause })
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError('cancelled', 'Analysis cancelled')
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function uniqueSorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}
