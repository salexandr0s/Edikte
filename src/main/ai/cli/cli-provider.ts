import type { ModelOption } from '@shared/providers'
import {
  ProviderError,
  type AiProvider,
  type AnalysisProgressHandler,
  type AnalysisRequest,
  type AnalysisResponse,
  type ProviderDetection,
} from '../provider'
import type { ResolvedCli } from './binary'
import { describeExit, signInFailureReason } from './cli-output'
import { errorDetail, isCancellation, type CliRuntime } from './cli-runtime'

/** What a CLI's status command reports about its sign-in. */
export interface CliAccount {
  loggedIn: boolean
  accountLabel: string | null
  plan: string | null
  /**
   * Hash of the account details: a different value means another account.
   * An equal value proves nothing when the CLI names no account; Codex
   * reports only the sign-in method, so a switch between two ChatGPT
   * accounts goes unnoticed.
   */
  fingerprint: string
}

export interface CliAnalysisContext<A extends CliAccount> {
  cli: ResolvedCli
  /** The installed version, checked right before the run. */
  version: string
  request: AnalysisRequest
  /** The account checked right before the run. */
  account: A
  signal: AbortSignal
  onProgress?: AnalysisProgressHandler
}

/** A help text and the flags it must list. */
export interface HelpCheck {
  /** Arguments that print the help, such as `exec --help`. */
  args: readonly string[]
  flags: readonly string[]
}

/** What differs between the Claude and the Codex CLI. */
export interface CliProviderDefinition<A extends CliAccount> {
  /** Help texts read once per version; a flag missing from one means "update required". */
  helpChecks: readonly HelpCheck[]
  /** A further check once per version, after the flags: why this version cannot be used, or null. */
  checkVersion?: (cli: ResolvedCli, version: string, signal?: AbortSignal) => Promise<string | null>
  /** The CLI's own sign-in: it opens the browser itself and exits when the sign-in is done. */
  loginArgs: readonly string[]
  models: readonly ModelOption[]
  readAccount: (cli: ResolvedCli, signal?: AbortSignal) => Promise<A>
  /** Throws invalid_request for a request the CLI cannot take, before any process starts. */
  validate: (request: AnalysisRequest, cli: ResolvedCli) => void
  /** The analysis run itself, between the two account checks. */
  analyze: (context: CliAnalysisContext<A>) => Promise<AnalysisResponse>
}

/**
 * The AiProvider around a CLI: flags checked once per version, the account
 * checked before and after every analysis, one job at a time. The account
 * check notices only what the fingerprint tells apart (see CliAccount). The
 * CLI keeps its sign-in; disconnect only stops the app from using it.
 */
export function createCliProvider<A extends CliAccount>(
  runtime: CliRuntime,
  definition: CliProviderDefinition<A>,
): AiProvider {
  const { provider, label } = runtime
  // The account the last check saw; a run under another one fails until the next check.
  let acceptedAccount: string | null = null
  let signingIn = false

  /** Why this version cannot run an isolated analysis, or null. */
  const versionProblem = async (
    cli: ResolvedCli,
    version: string,
    signal?: AbortSignal,
  ): Promise<string | null> => {
    const missing: string[] = []
    for (const check of definition.helpChecks) {
      missing.push(...(await runtime.missingFlags(cli, version, check.args, check.flags, signal)))
    }
    if (missing.length > 0) return `Missing flags: ${missing.join(' ')}`
    return (await definition.checkVersion?.(cli, version, signal)) ?? null
  }

  const requireVersion = async (cli: ResolvedCli, signal?: AbortSignal): Promise<string> => {
    const version = await runtime.readVersion(cli, signal)
    const problem = await versionProblem(cli, version, signal)
    if (problem) {
      throw new ProviderError(provider, 'cli_update_required', `${label} ${version}: ${problem}`)
    }
    return version
  }

  const detect = async (signal?: AbortSignal): Promise<ProviderDetection> => {
    const lookup = await runtime.resolve(signal)
    if (!lookup.cli) return runtime.detection({ state: 'not_installed', detail: lookup.detail })
    const cli = lookup.cli
    const found = { binaryPath: cli.path, binaryPathSource: cli.source }
    let version: string | null = null
    try {
      version = await runtime.readVersion(cli, signal)
      const problem = await versionProblem(cli, version, signal)
      if (problem) {
        return runtime.detection({ ...found, version, state: 'update_required', detail: problem })
      }
      const account = await definition.readAccount(cli, signal)
      if (!account.loggedIn) {
        return runtime.detection({
          ...found,
          version,
          state: signingIn ? 'signing_in' : 'signed_out',
        })
      }
      acceptedAccount = account.fingerprint
      return runtime.detection({
        ...found,
        version,
        state: 'ready',
        accountLabel: account.accountLabel,
        plan: account.plan,
      })
    } catch (error) {
      if (isCancellation(error)) throw error
      return runtime.detection({ ...found, version, state: 'error', detail: errorDetail(error) })
    }
  }

  const analyze = async (
    request: AnalysisRequest,
    signal: AbortSignal,
    onProgress?: AnalysisProgressHandler,
  ): Promise<AnalysisResponse> => {
    const cli = await runtime.requireCli(signal)
    definition.validate(request, cli)
    const version = await requireVersion(cli, signal)
    const account = await definition.readAccount(cli, signal)
    if (!account.loggedIn) {
      throw new ProviderError(provider, 'provider_not_connected', `${label} is not signed in`)
    }
    if (acceptedAccount !== null && acceptedAccount !== account.fingerprint) {
      throw new ProviderError(
        provider,
        'provider_account_changed',
        `The ${label} account changed since the last check`,
      )
    }
    const response = await definition.analyze({
      cli,
      version,
      request,
      account,
      signal,
      onProgress,
    })
    const after = await definition.readAccount(cli, signal)
    if (!after.loggedIn || after.fingerprint !== account.fingerprint) {
      throw new ProviderError(
        provider,
        'provider_account_changed',
        `The ${label} account changed during the analysis`,
      )
    }
    acceptedAccount = account.fingerprint
    return response
  }

  const connect = async (signal: AbortSignal): Promise<ProviderDetection> => {
    const cli = await runtime.requireCli(signal)
    const version = await requireVersion(cli, signal)
    signingIn = true
    // stdin is closed and the output is not shown: the CLI opens the browser on its own.
    const run = await runtime
      .invoke(cli, definition.loginArgs, { timeoutMs: runtime.limits.signInTimeoutMs, signal })
      .finally(() => {
        signingIn = false
      })
    if (run.exitCode !== 0) {
      const reason = signInFailureReason(run.stdout, run.stderr)
      throw new ProviderError(
        provider,
        'provider_auth',
        `${label} sign-in ${describeExit(run.exitCode)}${reason ? `: ${reason}` : ''}`,
      )
    }
    const account = await definition.readAccount(cli, signal)
    if (!account.loggedIn) {
      throw new ProviderError(
        provider,
        'provider_auth',
        `${label} reports no account after sign-in`,
      )
    }
    acceptedAccount = account.fingerprint
    return runtime.detection({
      state: 'ready',
      version,
      binaryPath: cli.path,
      binaryPathSource: cli.source,
      accountLabel: account.accountLabel,
      plan: account.plan,
    })
  }

  return {
    id: provider,
    detect,
    models: () => Promise.resolve(definition.models.map((model) => ({ ...model }))),
    analyze: (request, signal, onProgress) =>
      runtime.runJob(signal, (jobSignal) => analyze(request, jobSignal, onProgress)),
    connect: (signal) => runtime.runJob(signal, (jobSignal) => connect(jobSignal)),
    disconnect: () => {
      runtime.cancelJob()
      acceptedAccount = null
      return Promise.resolve()
    },
  }
}
