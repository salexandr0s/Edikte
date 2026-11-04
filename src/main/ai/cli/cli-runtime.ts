import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { CliProviderId } from '@shared/providers'
import { ProviderError, type ProviderDetection } from '../provider'
import {
  findCliBinary,
  isExecutableFile,
  type BinaryLookupResult,
  type LookupCommandResult,
  type ResolvedCli,
} from './binary'
import { describeExit, findMissingFlags, parseCliVersion, safeDetail } from './cli-output'
import { buildCliEnvironment, type EnvSource } from './environment'
import {
  DEFAULT_CLI_LIMITS,
  cliLabel,
  defaultSpawn,
  runCli,
  withTempDir,
  type CliLimits,
  type CliRunResult,
  type SpawnFunction,
} from './process'

export interface CliProviderOptions {
  /** The path chosen in Settings, or null to search. Read before every run. */
  getOverridePath: () => string | null | Promise<string | null>
  /** Parent of the per-run temp folders. Defaults to the OS temp folder. */
  tempRoot?: string
  now?: () => Date
  spawn?: SpawnFunction
  platform?: NodeJS.Platform
  /** Environment the whitelisted variables come from. Defaults to process.env. */
  env?: EnvSource
  homeDir?: string
  limits?: Partial<CliLimits>
  isExecutableFile?: (path: string) => Promise<boolean>
}

export interface InvokeSettings {
  timeoutMs: number
  signal?: AbortSignal
  input?: Buffer
  keepStdinOpen?: boolean
  onLine?: (line: string) => void
}

type DetectionFields = Partial<ProviderDetection> & Pick<ProviderDetection, 'state'>

/** What the Claude and Codex providers share: lookup, runs, version and flag checks, one job at a time. */
export class CliRuntime {
  readonly label: string
  readonly limits: CliLimits
  readonly platform: NodeJS.Platform
  private readonly options: CliProviderOptions
  private readonly env: EnvSource
  private readonly homeDir: string
  private readonly tempRoot: string
  private readonly spawn: SpawnFunction
  private readonly isExecutable: (path: string) => Promise<boolean>
  private readonly helpCache = new Map<string, string[]>()
  private job: AbortController | null = null

  constructor(
    readonly provider: CliProviderId,
    options: CliProviderOptions,
  ) {
    this.options = options
    this.label = cliLabel(provider)
    this.limits = { ...DEFAULT_CLI_LIMITS, ...options.limits }
    this.platform = options.platform ?? process.platform
    this.env = options.env ?? process.env
    this.homeDir = options.homeDir ?? homedir()
    this.tempRoot = options.tempRoot ?? tmpdir()
    this.spawn = options.spawn ?? defaultSpawn
    const platform = this.platform
    this.isExecutable = options.isExecutableFile ?? ((path) => isExecutableFile(path, platform))
  }

  now(): Date {
    return this.options.now ? this.options.now() : new Date()
  }

  detection(fields: DetectionFields): ProviderDetection {
    return {
      id: this.provider,
      version: null,
      binaryPath: null,
      binaryPathSource: null,
      accountLabel: null,
      plan: null,
      detail: null,
      checkedAt: this.now().toISOString(),
      ...fields,
    }
  }

  async resolve(): Promise<BinaryLookupResult> {
    const override = (await this.options.getOverridePath())?.trim() || null
    return findCliBinary(this.provider === 'claude-cli' ? 'claude' : 'codex', override, {
      platform: this.platform,
      env: this.env,
      homeDir: this.homeDir,
      timeoutMs: this.limits.lookupTimeoutMs,
      isExecutableFile: this.isExecutable,
      readTextFile: (path) => readFile(path, 'utf8'),
      runCommand: (command, args, env, timeoutMs) => this.runLookup(command, args, env, timeoutMs),
    })
  }

  async requireCli(): Promise<ResolvedCli> {
    const { cli, detail } = await this.resolve()
    if (!cli) {
      throw new ProviderError(this.provider, 'cli_not_found', detail ?? `${this.label} not found`)
    }
    return cli
  }

  /** Runs the CLI in a fresh private temp folder, or in `workDir` when the caller prepared one. */
  invoke(
    cli: ResolvedCli,
    args: readonly string[],
    settings: InvokeSettings,
    workDir?: string,
  ): Promise<CliRunResult> {
    const path = this.platform === 'win32' ? win32 : posix
    const run = (dir: string): Promise<CliRunResult> =>
      runCli({
        provider: this.provider,
        command: cli.command,
        args: [...cli.prefixArgs, ...args],
        cwd: dir,
        env: buildCliEnvironment({
          source: this.env,
          platform: this.platform,
          homeDir: this.homeDir,
          tempDir: dir,
          binaryDir: path.dirname(cli.path),
        }),
        input: settings.input ?? null,
        keepStdinOpen: settings.keepStdinOpen ?? false,
        onLine: settings.onLine,
        timeoutMs: settings.timeoutMs,
        signal: settings.signal,
        maxStdinBytes: this.limits.maxStdinBytes,
        maxStdoutBytes: settings.onLine
          ? this.limits.maxStdoutBytes
          : this.limits.maxProbeOutputBytes,
        maxStderrBytes: this.limits.maxStderrBytes,
        maxLineBytes: this.limits.maxLineBytes,
        killGraceMs: this.limits.killGraceMs,
        platform: this.platform,
        spawn: this.spawn,
      })
    return workDir === undefined ? this.withTempDir(run) : run(workDir)
  }

  withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    return withTempDir(this.tempRoot, fn)
  }

  async readVersion(cli: ResolvedCli, signal?: AbortSignal): Promise<string> {
    const run = await this.invoke(cli, ['--version'], {
      timeoutMs: this.limits.probeTimeoutMs,
      signal,
    })
    const version = run.exitCode === 0 ? parseCliVersion(run.stdout) : null
    if (!version) {
      throw new ProviderError(
        this.provider,
        'cli_failed',
        `${this.label} --version gave no version (${describeExit(run.exitCode)})`,
      )
    }
    return version
  }

  /** Flags from `required` that the installed version's help does not list. Read once per version. */
  async missingFlags(
    cli: ResolvedCli,
    version: string,
    helpArgs: readonly string[],
    required: readonly string[],
    signal?: AbortSignal,
  ): Promise<string[]> {
    const key = [cli.command, ...cli.prefixArgs, version].join('\0')
    const cached = this.helpCache.get(key)
    if (cached) return cached
    const run = await this.invoke(cli, helpArgs, { timeoutMs: this.limits.probeTimeoutMs, signal })
    if (run.exitCode !== 0) {
      throw new ProviderError(
        this.provider,
        'cli_failed',
        `${this.label} ${helpArgs.join(' ')} ${describeExit(run.exitCode)}`,
      )
    }
    const missing = findMissingFlags(run.stdout, required)
    this.helpCache.set(key, missing)
    return missing
  }

  /** One analysis or sign-in at a time per CLI. `cancelJob` (disconnect) aborts the running one. */
  async runJob<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.job) {
      throw new ProviderError(this.provider, 'busy', `${this.label} is already running a job`)
    }
    const controller = new AbortController()
    this.job = controller
    try {
      return await fn(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal)
    } finally {
      if (this.job === controller) this.job = null
    }
  }

  cancelJob(): void {
    this.job?.abort()
  }

  private runLookup(
    command: string,
    args: readonly string[],
    env: Record<string, string>,
    timeoutMs: number,
  ): Promise<LookupCommandResult> {
    return this.withTempDir(async (dir) => {
      const result = await runCli({
        provider: this.provider,
        command,
        args,
        cwd: dir,
        env,
        timeoutMs,
        maxStdinBytes: 0,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: this.limits.maxStderrBytes,
        maxLineBytes: this.limits.maxLineBytes,
        killGraceMs: this.limits.killGraceMs,
        platform: this.platform,
        spawn: this.spawn,
      })
      return { exitCode: result.exitCode, stdout: result.stdout }
    })
  }
}

export function isCancellation(error: unknown): boolean {
  return error instanceof ProviderError && error.code === 'cancelled'
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? safeDetail(error.message) : 'Unknown error'
}
