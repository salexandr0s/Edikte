import { ProviderError, type AiProvider } from '../provider'
import type { ResolvedCli } from './binary'
import {
  CLAUDE_ISOLATION_ARGS,
  CLAUDE_MODELS,
  CLAUDE_REQUIRED_FLAGS,
  ClaudeStreamParser,
  buildClaudeAnalysisArgs,
  encodeClaudeInput,
  isClaudeModel,
  parseClaudeAuthStatus,
  type ClaudeAuth,
} from './claude-protocol'
import { describeExit, safeDetail } from './cli-output'
import { createCliProvider } from './cli-provider'
import { CliRuntime, type CliProviderOptions } from './cli-runtime'

/** CreateProcess accepts 32,767 characters; the rest is margin for quoting. */
const WINDOWS_COMMAND_LINE_LIMIT = 32_000
/** Linux refuses a single argument over 128 KiB. */
const MAX_ARGUMENT_CHARS = 100_000

/**
 * Claude through the user's own `claude` binary and account. The app never
 * reads the CLI's tokens and never presents itself as Claude Code.
 */
export function createClaudeCliProvider(options: CliProviderOptions): AiProvider {
  const runtime = new CliRuntime('claude-cli', options)

  const readAccount = async (cli: ResolvedCli, signal?: AbortSignal): Promise<ClaudeAuth> => {
    const run = await runtime.invoke(cli, [...CLAUDE_ISOLATION_ARGS, 'auth', 'status', '--json'], {
      timeoutMs: runtime.limits.probeTimeoutMs,
      signal,
    })
    const auth = parseClaudeAuthStatus(run.stdout)
    if (!auth) {
      throw new ProviderError(
        'claude-cli',
        'cli_failed',
        `claude auth status gave no readable status (${describeExit(run.exitCode)})`,
      )
    }
    return { ...auth, loggedIn: auth.loggedIn && run.exitCode === 0 }
  }

  return createCliProvider<ClaudeAuth>(runtime, {
    helpArgs: ['--help'],
    requiredFlags: CLAUDE_REQUIRED_FLAGS,
    loginArgs: [...CLAUDE_ISOLATION_ARGS, 'auth', 'login', '--claudeai'],
    models: CLAUDE_MODELS,
    readAccount,
    validate: (request, cli) => {
      if (!isClaudeModel(request.model)) {
        throw new ProviderError(
          'claude-cli',
          'invalid_request',
          `Unknown Claude CLI model "${safeDetail(request.model, 40)}"`,
        )
      }
      checkCommandLine(
        [cli.command, ...cli.prefixArgs, ...buildClaudeAnalysisArgs(request)],
        runtime.platform,
      )
    },
    analyze: async ({ cli, request, account, signal, onProgress }) => {
      const parser = new ClaudeStreamParser(onProgress)
      const run = await runtime.invoke(cli, buildClaudeAnalysisArgs(request), {
        input: encodeClaudeInput(request.content),
        onLine: (line) => parser.push(line),
        timeoutMs: runtime.limits.analysisTimeoutMs,
        signal,
      })
      const outcome = parser.finish(run.exitCode, run.stderr)
      return {
        json: outcome.structuredOutput,
        usage: {
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
          // The CLI prices subscription runs as well; that figure is not money spent.
          costUsd: account.subscription ? null : outcome.costUsd,
        },
        model: outcome.model ?? request.model,
        accountLabel: account.accountLabel,
        raw: outcome.raw,
      }
    },
  })
}

/** The system prompt and schema travel as arguments, which have length limits. */
function checkCommandLine(argv: readonly string[], platform: NodeJS.Platform): void {
  if (argv.some((arg) => arg.length > MAX_ARGUMENT_CHARS)) {
    throw new ProviderError(
      'claude-cli',
      'invalid_request',
      'The system prompt or schema is too long for the command line',
    )
  }
  // Windows wraps each argument in quotes and escapes the quotes inside it.
  const length = argv.reduce((sum, arg) => sum + arg.length + arg.split('"').length + 2, 0)
  if (platform === 'win32' && length > WINDOWS_COMMAND_LINE_LIMIT) {
    throw new ProviderError(
      'claude-cli',
      'invalid_request',
      `The command line would be ${length} characters, over the Windows limit`,
    )
  }
}
