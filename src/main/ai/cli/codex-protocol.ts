import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AppErrorCode } from '@shared/errors'
import type { ModelOption } from '@shared/providers'
import { ProviderError, type AnalysisContentPart, type AnalysisProgressHandler } from '../provider'
import { describeExit, lastLine, safeDetail } from './cli-output'
import type { CliAccount } from './cli-provider'

/** The account default; Settings also accepts a typed model ID. */
export const CODEX_MODELS: readonly ModelOption[] = [
  { id: 'default', label: 'Default', supportsImages: true, isDefault: true },
]

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

/** A typed model ID must start with a letter or digit, so it can never read as a flag. */
export function isCodexModel(id: string): boolean {
  return id === 'default' || MODEL_ID.test(id)
}

/** Every flag of the exec run, checked against `codex exec --help`. */
export const CODEX_REQUIRED_FLAGS: readonly string[] = [
  '--json',
  '--output-schema',
  '-o',
  '-s',
  '--skip-git-repo-check',
  '--ephemeral',
  '--ignore-user-config',
  '--ignore-rules',
  '-C',
  '-m',
  '-i',
]

/**
 * Codex is a coding agent with its own instructions, and exec has no system
 * prompt flag, so the run starts with this and then the app's instructions.
 */
export const CODEX_FRAMING =
  'A desktop app runs you non-interactively for one request. Work only with the text and images in this message. Do not run commands, read or write files, or use any other tool. Your final message must be the JSON object that the output schema describes, and nothing else.'

export interface CodexImageFile {
  fileName: string
  data: Buffer
}

/** The stdin prompt; images become files for `-i`, with a marker where each one belongs. */
export function buildCodexPrompt(
  system: string,
  content: readonly AnalysisContentPart[],
): { prompt: string; images: CodexImageFile[] } {
  const images: CodexImageFile[] = []
  const parts = [CODEX_FRAMING, system.trim()]
  for (const part of content) {
    if (part.type === 'text') {
      parts.push(part.text)
      continue
    }
    const index = images.length + 1
    images.push({ fileName: `image-${index}-page-${part.page}.jpg`, data: part.data })
    parts.push(`[Attached image ${index}: PDF page ${part.page}]`)
  }
  return { prompt: `${parts.filter((part) => part.trim() !== '').join('\n\n')}\n`, images }
}

export interface CodexExecPaths {
  workDir: string
  schemaPath: string
  answerPath: string
  /** Relative to workDir, which is also the process's working folder. */
  imageFiles: readonly string[]
}

/**
 * The plan's flags. `-i <FILE>...` takes several values, so the images come
 * right after --json and before another flag: placed last, `-i` would swallow
 * the final `-` (prompt from stdin) as one more image.
 */
export function buildCodexExecArgs(paths: CodexExecPaths, model: string): string[] {
  return [
    'exec',
    '--json',
    ...paths.imageFiles.flatMap((file) => ['-i', file]),
    '--output-schema',
    paths.schemaPath,
    '-o',
    paths.answerPath,
    '-s',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '-C',
    paths.workDir,
    ...(model === 'default' ? [] : ['-m', model]),
    '-',
  ]
}

// ── login status ───────────────────────────────────────────────────────────

/**
 * `codex login status` prints e.g. "Logged in using ChatGPT" (to stderr) and
 * exits 1 when signed out. Codex names no account, so the fingerprint, a hash
 * of that line, only tells sign-in methods apart.
 */
export function parseCodexLoginStatus(
  exitCode: number | null,
  stdout: string,
  stderr: string,
): CliAccount {
  const line =
    `${stdout}\n${stderr}`
      .split(/\r?\n/)
      .map((entry) => safeDetail(entry, 200))
      .find((entry) => /logged in/i.test(entry)) ?? ''
  const loggedIn = exitCode === 0 && line !== '' && !/not logged in/i.test(line)
  let plan: string | null = null
  if (loggedIn && /chatgpt/i.test(line)) plan = 'ChatGPT'
  else if (loggedIn && /api key/i.test(line)) plan = 'API key'
  return {
    loggedIn,
    accountLabel: null,
    plan,
    fingerprint: createHash('sha256').update(line.toLowerCase()).digest('hex'),
  }
}

// ── exec --json events ─────────────────────────────────────────────────────

export function codexErrorCode(message: string): AppErrorCode {
  if (/usage limit|rate limit|too many requests|\b429\b/i.test(message))
    return 'provider_rate_limit'
  if (/quota|billing|insufficient|credits|payment|\b402\b/i.test(message)) return 'provider_billing'
  if (
    /not logged in|log ?in again|sign ?in again|unauthori[sz]ed|\b401\b|\b403\b|authenticat|expired/i.test(
      message,
    )
  ) {
    return 'provider_auth'
  }
  if (/context window|context length|too long|max(?:imum)? output tokens/i.test(message)) {
    return 'provider_incomplete'
  }
  return 'cli_failed'
}

const EventSchema = z.object({ type: z.string() })
const ItemEventSchema = z.object({ item: z.object({ type: z.string() }) })
const TurnCompletedSchema = z.object({
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional()
    .catch(undefined),
})
const FailureSchema = z.object({
  message: z.string().optional().catch(undefined),
  error: z.object({ message: z.string() }).optional().catch(undefined),
})

/**
 * Item types of a plain answer. "error" items are warnings (e.g. about skipped
 * agent files); anything else, such as command_execution, file_change,
 * mcp_tool_call or web_search, means Codex used a tool and the run stops.
 */
const ALLOWED_ITEM_TYPES = new Set(['agent_message', 'reasoning', 'todo_list', 'error'])

export interface CodexRunOutcome {
  inputTokens: number | null
  outputTokens: number | null
  /** The JSONL events, for the analysis record. */
  raw: string
}

const invalid = (message: string): ProviderError =>
  new ProviderError('codex-cli', 'provider_invalid_output', message)

function failureMessage(value: unknown): string | null {
  const parsed = FailureSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data.error?.message ?? parsed.data.message ?? null
}

/** Reads `codex exec --json` events line by line and stops the run on a tool step or a failed turn. */
export class CodexEventParser {
  private readonly lines: string[] = []
  private readonly onProgress: AnalysisProgressHandler | undefined
  private completed = false
  private inputTokens: number | null = null
  private outputTokens: number | null = null
  private lastError: string | null = null

  constructor(onProgress?: AnalysisProgressHandler) {
    this.onProgress = onProgress
  }

  push(line: string): void {
    if (line.trim() === '') return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw invalid('A Codex event is not JSON')
    }
    const event = EventSchema.safeParse(value)
    if (!event.success) throw invalid('A Codex event has no type')
    this.lines.push(line)
    switch (event.data.type) {
      case 'turn.started':
        this.onProgress?.({ phase: 'waiting' })
        return
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.readItem(value)
        return
      case 'turn.completed':
        this.readUsage(value)
        this.completed = true
        return
      case 'turn.failed': {
        const message = failureMessage(value) ?? 'The turn failed'
        throw new ProviderError(
          'codex-cli',
          codexErrorCode(message),
          `Codex: ${safeDetail(message)}`,
        )
      }
      case 'error':
        // Not final by itself: Codex may retry. A failed turn or the exit code decides.
        this.lastError = failureMessage(value)
        return
      default:
        return
    }
  }

  finish(exitCode: number | null, stderr: string): CodexRunOutcome {
    if (exitCode !== 0) {
      const detail = this.lastError ?? lastLine(stderr)
      throw new ProviderError(
        'codex-cli',
        detail ? codexErrorCode(detail) : 'cli_failed',
        `Codex ${describeExit(exitCode)}${detail ? `: ${safeDetail(detail)}` : ''}`,
      )
    }
    if (!this.completed) {
      throw new ProviderError(
        'codex-cli',
        'provider_incomplete',
        'Codex ended without finishing the turn',
      )
    }
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      raw: this.lines.join('\n'),
    }
  }

  private readItem(value: unknown): void {
    const parsed = ItemEventSchema.safeParse(value)
    if (!parsed.success) throw invalid('A Codex item has no type')
    const type = parsed.data.item.type
    if (!ALLOWED_ITEM_TYPES.has(type)) {
      throw invalid(`Codex started a ${safeDetail(type, 40)} step; the app allows no tools`)
    }
    if (type === 'agent_message' || type === 'reasoning') this.onProgress?.({ phase: 'streaming' })
  }

  private readUsage(value: unknown): void {
    const parsed = TurnCompletedSchema.safeParse(value)
    const usage = parsed.success ? parsed.data.usage : undefined
    if (!usage) return
    // cached_input_tokens is part of input_tokens.
    this.inputTokens = (this.inputTokens ?? 0) + usage.input_tokens
    this.outputTokens = (this.outputTokens ?? 0) + usage.output_tokens
  }
}

/** The `-o` file holds the last agent message: the JSON answer, sometimes inside a code fence. */
export function parseCodexAnswer(text: string): unknown {
  let body = text.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(body)
  if (fenced?.[1] !== undefined) body = fenced[1].trim()
  if (body === '') {
    throw new ProviderError(
      'codex-cli',
      'provider_incomplete',
      'Codex wrote an empty final message',
    )
  }
  try {
    const value: unknown = JSON.parse(body)
    return value
  } catch {
    throw invalid('The final Codex message is not JSON')
  }
}
