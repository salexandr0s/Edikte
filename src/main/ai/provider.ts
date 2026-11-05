import { AppError, type AppErrorCode } from '@shared/errors'
import type { ModelOption, ProviderId, ProviderStatus } from '@shared/providers'

/**
 * The contract every AI route implements: ChatGPT sign-in, the Claude and
 * Codex CLIs, and the OpenAI and Anthropic API keys. Providers know nothing
 * about Gutachten; src/main/ai/analysis/ builds the prompt and parses results.
 *
 * Rules for implementations:
 * - Tokens and keys never leave the main process and never appear in errors or logs.
 * - `analyze` records provider, model and account when it starts and fails with
 *   `provider_account_changed` if the account changes mid-run. No silent fallback
 *   to another provider or model.
 * - Every long operation honours its AbortSignal and fails with `cancelled`.
 */
export interface AiProvider {
  readonly id: ProviderId

  /** Installed, version, signed in, account. Cheap enough to run on launch. */
  detect(signal?: AbortSignal): Promise<ProviderDetection>

  /** Models the account can use, for the Settings picker. */
  models(signal?: AbortSignal): Promise<ModelOption[]>

  analyze(
    request: AnalysisRequest,
    signal: AbortSignal,
    onProgress?: AnalysisProgressHandler,
  ): Promise<AnalysisResponse>

  /** Starts the provider's own sign-in flow. Resolves when it finishes. */
  connect?(signal: AbortSignal): Promise<ProviderDetection>

  /** Deletes the app's own credentials (revoking them where possible). */
  disconnect?(): Promise<void>

  /** Checks the key by listing models, then stores it encrypted. */
  setApiKey?(key: string, signal?: AbortSignal): Promise<ProviderDetection>
}

/** Detection result before the app adds selection and saved model. */
export type ProviderDetection = Omit<ProviderStatus, 'selected' | 'model'>

export type AnalysisContentPart =
  | { type: 'text'; text: string }
  /** A rendered scanned page. Only sent to models that accept images. */
  | { type: 'image'; mediaType: 'image/jpeg'; data: Buffer; page: number }

export interface AnalysisRequest {
  model: string
  system: string
  content: AnalysisContentPart[]
  /** Provider-safe JSON Schema for the answer: all properties required, no extra keys. */
  jsonSchema: Record<string, unknown>
  /** Short identifier some APIs require alongside the schema. */
  schemaName: string
  maxOutputTokens: number
}

export interface AnalysisUsage {
  inputTokens: number | null
  outputTokens: number | null
  /** Reported or computed cost; null when unknown (e.g. subscriptions). */
  costUsd: number | null
}

export interface AnalysisResponse {
  /** Parsed JSON as the provider returned it; validated by the caller. */
  json: unknown
  usage: AnalysisUsage
  /** Model the provider reports it used. */
  model: string
  /** Account the run used, for the record. */
  accountLabel: string | null
  /** Provider output for debugging. Must not contain credentials. */
  raw: string
}

export type AnalysisProgressHandler = (event: {
  phase: 'waiting' | 'streaming'
  outputTokens?: number
}) => void

/** Error raised by providers; `code` maps to a translated message in the UI. */
export class ProviderError extends AppError {
  /** Tokens and cost the failed request still used, when the provider reported them. */
  readonly usage: AnalysisUsage | null

  constructor(
    readonly provider: ProviderId,
    code: AppErrorCode,
    message: string,
    options?: ErrorOptions & { usage?: AnalysisUsage },
  ) {
    super(code, message, options)
    this.usage = options?.usage ?? null
  }
}
