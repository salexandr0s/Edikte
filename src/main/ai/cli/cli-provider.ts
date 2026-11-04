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
import { describeExit } from './cli-output'
import { errorDetail, isCancellation, type CliRuntime } from './cli-runtime'

/** What a CLI's status command reports about its sign-in. */
export interface CliAccount {
  loggedIn: boolean
  accountLabel: string | null
  plan: string | null
  /** Hash of the account details; a different value means another account. */
  fingerprint: string
}

export interface CliAnalysisContext<A extends CliAccount> {
  cli: ResolvedCli
  request: AnalysisRequest
  /** The account checked right before the run. */
  account: A
  signal: AbortSignal
  onProgress?: AnalysisProgressHandler
}

/** What differs between the Claude and the Codex CLI. */
export interface CliProviderDefinition<A extends CliAccount> {
  /** Arguments that print the help listing the analysis flags. */
  helpArgs: readonly string[]
  requiredFlags: readonly string[]
  /** The CLI's own sign-in, which opens the browser and exits when it is done. */
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
 * checked before and after every analysis, one job at a time. The CLI keeps
 * its sign-in; disconnect only stops the app from using it.
 */
export function createCliProvider<A extends CliAccount>(
  runtime: CliRuntime,
  definition: CliProviderDefinition<A>,
): AiProvider {
  const { provider, label } = runtime
  // The account the last check saw; a run under another one fails until the next check.
  let acceptedAccount: string | null = null
  let signingIn = false

  const missingFlags = (
    cli: ResolvedCli,
    version: string,
    signal?: AbortSignal,
  ): Promise<string[]> =>
    runtime.missingFlags(cli, version, definition.helpArgs, definition.requiredFlags, signal)

  const requireFlags = async (cli: ResolvedCli, signal?: AbortSignal): Promise<string> => {
    const version = await runtime.readVersion(cli, signal)
    const missing = await missingFlags(cli, version, signal)
    if (missing.length > 0) {
      throw new ProviderError(
        provider,
        'cli_update_required',
        `${label} ${version} lacks ${missing.join(' ')}`,
      )
    }
    return version
  }

  const detect = async (signal?: AbortSignal): Promise<ProviderDetection> => {
    const lookup = await runtime.resolve()
    if (!lookup.cli) return runtime.detection({ state: 'not_installed', detail: lookup.detail })
    const cli = lookup.cli
    const found = { binaryPath: cli.path, binaryPathSource: cli.source }
    let version: string | null = null
    try {
      version = await runtime.readVersion(cli, signal)
      const missing = await missingFlags(cli, version, signal)
      if (missing.length > 0) {
        return runtime.detection({
          ...found,
          version,
          state: 'update_required',
          detail: `Missing flags: ${missing.join(' ')}`,
        })
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
    const cli = await runtime.requireCli()
    definition.validate(request, cli)
    await requireFlags(cli, signal)
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
    const response = await definition.analyze({ cli, request, account, signal, onProgress })
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
    const cli = await runtime.requireCli()
    const version = await requireFlags(cli, signal)
    signingIn = true
    const run = await runtime
      .invoke(cli, definition.loginArgs, {
        // The sign-in may wait for a code pasted into the terminal it opened.
        keepStdinOpen: true,
        timeoutMs: runtime.limits.signInTimeoutMs,
        signal,
      })
      .finally(() => {
        signingIn = false
      })
    if (run.exitCode !== 0) {
      throw new ProviderError(
        provider,
        'provider_auth',
        `${label} sign-in ${describeExit(run.exitCode)}`,
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
