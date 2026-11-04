import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AppErrorCode } from '@shared/errors'
import type { ModelOption } from '@shared/providers'
import {
  ProviderError,
  type AnalysisContentPart,
  type AnalysisProgressHandler,
  type AnalysisRequest,
} from '../provider'
import { describeExit, lastLine, safeDetail } from './cli-output'
import type { CliAccount } from './cli-provider'

/** Aliases the CLI resolves itself; `default` leaves the choice to the account. */
export const CLAUDE_MODELS: readonly ModelOption[] = [
  { id: 'default', label: 'Default', supportsImages: true, isDefault: true },
  { id: 'opus', label: 'Opus', supportsImages: true, isDefault: false },
  { id: 'sonnet', label: 'Sonnet', supportsImages: true, isDefault: false },
  { id: 'haiku', label: 'Haiku', supportsImages: true, isDefault: false },
]

export function isClaudeModel(id: string): boolean {
  return CLAUDE_MODELS.some((model) => model.id === id)
}

/** Every flag of the analysis run. A version without one of them gets "update required". */
export const CLAUDE_REQUIRED_FLAGS: readonly string[] = [
  '--safe-mode',
  '--setting-sources',
  '--settings',
  '--disable-slash-commands',
  '--tools',
  '--strict-mcp-config',
  '--mcp-config',
  '--no-chrome',
  '--print',
  '--no-session-persistence',
  '--output-format',
  '--verbose',
  '--input-format',
  '--system-prompt',
  '--json-schema',
  '--model',
]

/**
 * Switches off everything the user configured: settings files, hooks, plugins,
 * skills, slash commands, MCP servers, built-in tools and the Chrome bridge.
 * As ternmail validated them on Claude Code 2.1.226.
 */
export const CLAUDE_ISOLATION_ARGS: readonly string[] = [
  '--safe-mode',
  '--setting-sources',
  '',
  '--settings',
  '{"disableAllHooks":true,"enabledPlugins":{}}',
  '--disable-slash-commands',
  '--tools',
  '',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
  '--no-chrome',
]

/**
 * The system prompt and schema travel on the command line, where other local
 * processes can read them; document text only ever goes to stdin.
 */
export function buildClaudeAnalysisArgs(
  request: Pick<AnalysisRequest, 'model' | 'system' | 'jsonSchema'>,
): string[] {
  return [
    ...CLAUDE_ISOLATION_ARGS,
    '--print',
    '--no-session-persistence',
    '--output-format',
    'stream-json',
    '--verbose',
    '--input-format',
    'stream-json',
    '--system-prompt',
    request.system,
    '--json-schema',
    JSON.stringify(request.jsonSchema),
    ...(request.model === 'default' ? [] : ['--model', request.model]),
  ]
}

/** The prompt as one stream-json user message: text blocks and base64 image blocks. */
export function encodeClaudeInput(content: readonly AnalysisContentPart[]): Buffer {
  const blocks: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (part.type === 'text') {
      // The API rejects empty text blocks.
      if (part.text.trim() !== '') blocks.push({ type: 'text', text: part.text })
      continue
    }
    blocks.push({ type: 'text', text: `[Image: PDF page ${part.page}]` })
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: part.mediaType, data: part.data.toString('base64') },
    })
  }
  if (blocks.length === 0) {
    throw new ProviderError('claude-cli', 'invalid_request', 'The analysis request has no content')
  }
  const message = {
    type: 'user',
    message: { role: 'user', content: blocks },
    parent_tool_use_id: null,
  }
  return Buffer.from(`${JSON.stringify(message)}\n`, 'utf8')
}

// ── auth status ────────────────────────────────────────────────────────────

export interface ClaudeAuth extends CliAccount {
  /** Paid through a Claude subscription, so the CLI's cost figure is not money spent. */
  subscription: boolean
}

const optionalText = z.string().max(512).nullish().catch(null)

const AuthStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: optionalText,
  apiProvider: optionalText,
  email: optionalText,
  orgId: optionalText,
  orgName: optionalText,
  accountId: optionalText,
  userId: optionalText,
  subscriptionType: optionalText,
})

const PLAN_LABELS: Readonly<Record<string, string>> = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
  team: 'Team',
  enterprise: 'Enterprise',
}

const SAFE_LABEL = /^[A-Za-z0-9_.-]{1,64}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/

/** Lenient reader for `claude auth status --json`; null when the output is not that JSON. */
export function parseClaudeAuthStatus(stdout: string): ClaudeAuth | null {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return null
  }
  const parsed = AuthStatusSchema.safeParse(value)
  if (!parsed.success) return null
  const status = parsed.data
  const label = (text: string | null | undefined): string | null =>
    text && SAFE_LABEL.test(text) ? text : null
  const method = label(status.authMethod)
  const provider = label(status.apiProvider)
  const subscriptionType = label(status.subscriptionType)
  const identity = (['email', 'orgId', 'accountId', 'userId'] as const).flatMap((field) => {
    const text = status[field]
    return text ? [`${field}:${text.toLowerCase()}`] : []
  })
  const fingerprint = createHash('sha256')
    .update([method ?? '', provider ?? '', subscriptionType ?? '', ...identity].join('\0'))
    .digest('hex')
  const email = status.email && EMAIL.test(status.email) ? status.email : null
  const orgName = status.orgName ? safeDetail(status.orgName, 100) : null
  let plan: string | null = null
  if (subscriptionType) {
    plan =
      PLAN_LABELS[subscriptionType.toLowerCase()] ??
      subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1)
  } else if (method && method.toLowerCase() !== 'claude.ai') {
    plan = 'API'
  }
  return {
    loggedIn: status.loggedIn,
    accountLabel: email ?? (orgName || null),
    plan,
    subscription: method?.toLowerCase() === 'claude.ai' || subscriptionType !== null,
    fingerprint,
  }
}

// ── error mapping ──────────────────────────────────────────────────────────

/** `error` on an assistant line (SDKAssistantMessageError). */
export function claudeAssistantErrorCode(error: string): AppErrorCode {
  switch (error) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'account_on_hold':
      return 'provider_auth'
    case 'billing_error':
      return 'provider_billing'
    case 'rate_limit':
      return 'provider_rate_limit'
    case 'max_output_tokens':
      return 'provider_incomplete'
    case 'invalid_request':
      return 'cli_failed'
    default:
      return 'provider_unavailable'
  }
}

/** `subtype` of a result line other than success. */
export function claudeResultSubtypeCode(subtype: string): AppErrorCode {
  switch (subtype) {
    case 'error_max_budget_usd':
      return 'provider_billing'
    case 'error_max_turns':
    case 'error_max_structured_output_retries':
      return 'provider_incomplete'
    default:
      return 'cli_failed'
  }
}

/** `stop_reason` values that mean the answer is not complete; null for a normal stop. */
export function claudeStopReasonCode(reason: string): AppErrorCode | null {
  switch (reason) {
    case 'refusal':
      return 'provider_refused'
    case 'max_tokens':
    case 'model_context_window_exceeded':
    case 'pause_turn':
    case 'tool_deferred':
    case 'error':
      return 'provider_incomplete'
    default:
      return null
  }
}

/** `api_error_status` of a result line with `is_error: true`. */
export function claudeApiStatusCode(status: number | null): AppErrorCode {
  if (status === 401 || status === 403) return 'provider_auth'
  if (status === 402) return 'provider_billing'
  if (status === 429) return 'provider_rate_limit'
  if (status === 413) return 'document_too_large'
  if (status !== null && status >= 500) return 'provider_unavailable'
  return 'cli_failed'
}

// ── stream-json output ─────────────────────────────────────────────────────

// Zod 4 rejects a missing key even when its schema is z.unknown(), so keys the
// CLI leaves out on some lines are marked optional.
const LineSchema = z.object({
  type: z.string(),
  subtype: z.unknown().optional(),
  parent_tool_use_id: z.unknown().optional(),
})

const InitSchema = z.object({
  tools: z.array(z.string()),
  mcp_servers: z.array(z.unknown()),
  plugins: z.array(z.unknown()),
  skills: z.array(z.unknown()),
  model: z.string().max(200).optional().catch(undefined),
})

const BlockSchema = z.object({ type: z.string(), name: z.string().optional().catch(undefined) })

const AssistantSchema = z.object({
  aborted: z.boolean().optional().catch(undefined),
  error: z.string().nullish().catch('unknown'),
  message: z
    .object({
      content: z.array(BlockSchema).optional().catch(undefined),
      usage: z.object({ output_tokens: z.number().nonnegative() }).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
})

const StreamEventSchema = z.object({
  event: z.object({ type: z.string(), content_block: BlockSchema.optional().catch(undefined) }),
})

const ThinkingSchema = z.object({ estimated_tokens: z.number().nonnegative() })

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
})

const ResultSchema = z.object({
  subtype: z.string(),
  is_error: z.boolean(),
  stop_reason: z.string().nullish().catch(null),
  api_error_status: z.number().nullish().catch(null),
  structured_output: z.unknown().optional(),
  deferred_tool_use: z.unknown().optional(),
  usage: z.unknown().optional(),
  total_cost_usd: z.number().nullish().catch(null),
})

export interface ClaudeRunOutcome {
  structuredOutput: unknown
  /** Includes cache reads and writes. */
  inputTokens: number | null
  outputTokens: number | null
  /** As the CLI reports it; it computes a figure even for subscriptions. */
  costUsd: number | null
  /** From system/init, e.g. claude-haiku-4-5-20251001. */
  model: string | null
  /** The init and result lines, for the analysis record. */
  raw: string
}

const invalid = (message: string): ProviderError =>
  new ProviderError('claude-cli', 'provider_invalid_output', message)

/**
 * Checks `--output-format stream-json` line by line, as ternmail's helper does.
 * Throws on the first line that breaks a rule, so the run stops right there.
 */
export class ClaudeStreamParser {
  private initLine: string | null = null
  private resultLine: string | null = null
  private model: string | null = null
  private outcome: Omit<ClaudeRunOutcome, 'model' | 'raw'> | null = null
  private streamedTokens = 0
  private readonly onProgress: AnalysisProgressHandler | undefined

  constructor(onProgress?: AnalysisProgressHandler) {
    this.onProgress = onProgress
  }

  push(line: string): void {
    if (line.trim() === '') return
    if (this.resultLine !== null) throw invalid('The CLI wrote more output after the result line')
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw invalid('A line of CLI output is not JSON')
    }
    const envelope = LineSchema.safeParse(value)
    if (!envelope.success) throw invalid('A line of CLI output has no type')
    const { type, subtype, parent_tool_use_id: parent } = envelope.data
    if (parent != null) throw invalid('The CLI ran a subagent')
    if (this.initLine === null) {
      if (type !== 'system' || subtype !== 'init')
        throw invalid('The first line is not system/init')
      this.readInit(value, line)
      return
    }
    switch (type) {
      case 'system':
        if (subtype === 'init') throw invalid('The CLI started a second session')
        if (subtype === 'thinking_tokens') this.readThinking(value)
        return
      case 'assistant':
        this.readAssistant(value)
        return
      case 'stream_event':
        this.readStreamEvent(value)
        return
      case 'result':
        this.readResult(value, line)
        return
      default:
        // user lines carry the StructuredOutput tool results; rate_limit_event is a notice.
        return
    }
  }

  finish(exitCode: number | null, stderr: string): ClaudeRunOutcome {
    if (exitCode !== 0) {
      const detail = lastLine(stderr)
      throw new ProviderError(
        'claude-cli',
        'cli_failed',
        `The Claude CLI ${describeExit(exitCode)}${detail ? `: ${safeDetail(detail, 200)}` : ''}`,
      )
    }
    if (this.initLine === null || this.resultLine === null || this.outcome === null) {
      throw new ProviderError(
        'claude-cli',
        'provider_incomplete',
        'The Claude CLI ended without a result',
      )
    }
    return { ...this.outcome, model: this.model, raw: `${this.initLine}\n${this.resultLine}` }
  }

  private readInit(value: unknown, line: string): void {
    const init = InitSchema.safeParse(value)
    if (!init.success)
      throw invalid('system/init lacks the tool, MCP server, plugin or skill lists')
    const tools = init.data.tools.filter((tool) => tool !== 'StructuredOutput')
    if (tools.length > 0)
      throw invalid(`The CLI offered tools: ${safeDetail(tools.join(', '), 120)}`)
    for (const key of ['mcp_servers', 'plugins', 'skills'] as const) {
      if (init.data[key].length > 0) throw invalid(`The CLI loaded ${key.replace('_', ' ')}`)
    }
    this.initLine = line
    this.model = init.data.model ?? null
    this.onProgress?.({ phase: 'waiting' })
  }

  private readThinking(value: unknown): void {
    const thinking = ThinkingSchema.safeParse(value)
    if (thinking.success) this.reportTokens(thinking.data.estimated_tokens)
  }

  /** Thinking estimates and message usage arrive mixed; the count shown never goes down. */
  private reportTokens(count: number): void {
    this.streamedTokens = Math.max(this.streamedTokens, count)
    this.onProgress?.({ phase: 'streaming', outputTokens: this.streamedTokens })
  }

  private readAssistant(value: unknown): void {
    const parsed = AssistantSchema.safeParse(value)
    if (!parsed.success) throw invalid('Unreadable assistant message')
    const { aborted, error, message } = parsed.data
    if (aborted)
      throw new ProviderError('claude-cli', 'provider_incomplete', 'The CLI aborted the answer')
    if (error) {
      throw new ProviderError(
        'claude-cli',
        claudeAssistantErrorCode(error),
        `Claude reported ${safeDetail(error, 60)}`,
      )
    }
    if (!message?.content) throw invalid('Assistant message without content')
    for (const block of message.content) checkBlock(block)
    if (message.usage) this.reportTokens(message.usage.output_tokens)
  }

  private readStreamEvent(value: unknown): void {
    const parsed = StreamEventSchema.safeParse(value)
    if (!parsed.success) return
    const { event } = parsed.data
    if (event.type === 'error') {
      throw new ProviderError(
        'claude-cli',
        'provider_unavailable',
        'The model stream reported an error',
      )
    }
    if (event.type === 'content_block_start' && event.content_block) checkBlock(event.content_block)
  }

  private readResult(value: unknown, line: string): void {
    const parsed = ResultSchema.safeParse(value)
    if (!parsed.success) throw invalid('Unreadable result line')
    const result = parsed.data
    if (result.subtype !== 'success') {
      throw new ProviderError(
        'claude-cli',
        claudeResultSubtypeCode(result.subtype),
        `The CLI ended with ${safeDetail(result.subtype, 60)}`,
      )
    }
    const status = result.api_error_status ?? null
    if (result.is_error) {
      throw new ProviderError(
        'claude-cli',
        claudeApiStatusCode(status),
        `The CLI reported an error${status === null ? '' : ` (HTTP ${status})`}`,
      )
    }
    const stopReason = result.stop_reason ?? null
    const stopCode = stopReason === null ? null : claudeStopReasonCode(stopReason)
    if (stopReason !== null && stopCode !== null) {
      throw new ProviderError(
        'claude-cli',
        stopCode,
        `The answer stopped with ${safeDetail(stopReason, 60)}`,
      )
    }
    if (result.deferred_tool_use != null) throw invalid('The CLI deferred a tool call')
    if (result.structured_output == null) throw invalid('The result has no structured_output')
    const usage = UsageSchema.safeParse(result.usage)
    const cost = result.total_cost_usd ?? null
    this.outcome = {
      structuredOutput: result.structured_output,
      inputTokens: usage.success
        ? usage.data.input_tokens +
          (usage.data.cache_creation_input_tokens ?? 0) +
          (usage.data.cache_read_input_tokens ?? 0)
        : null,
      outputTokens: usage.success ? usage.data.output_tokens : null,
      costUsd: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null,
    }
    this.resultLine = line
  }
}

function checkBlock(block: z.infer<typeof BlockSchema>): void {
  if (block.type === 'tool_use' && block.name !== 'StructuredOutput') {
    throw invalid(`The model called the tool ${safeDetail(block.name ?? 'unknown', 60)}`)
  }
  if (block.type === 'server_tool_use' || block.type === 'mcp_tool_use') {
    throw invalid(`The model used ${block.type}`)
  }
}
