import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import type { CliProviderId } from '@shared/providers'
import { log } from '../../log'
import { ProviderError } from '../provider'

export type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

export const defaultSpawn: SpawnFunction = (command, args, options) =>
  nodeSpawn(command, args, options)

export interface CliLimits {
  /** The Claude CLI caps piped stdin at 10 MB. */
  maxStdinBytes: number
  maxStdoutBytes: number
  maxStderrBytes: number
  maxLineBytes: number
  /** stdout of --version, --help, auth status and sign-in. */
  maxProbeOutputBytes: number
  analysisTimeoutMs: number
  probeTimeoutMs: number
  signInTimeoutMs: number
  /** Login-shell and where.exe lookups. */
  lookupTimeoutMs: number
  /** Wait between SIGTERM and SIGKILL, and for pipes to close after exit. */
  killGraceMs: number
}

export const DEFAULT_CLI_LIMITS: Readonly<CliLimits> = {
  maxStdinBytes: 9_000_000,
  maxStdoutBytes: 8 * 1024 * 1024,
  maxStderrBytes: 128 * 1024,
  maxLineBytes: 1024 * 1024,
  maxProbeOutputBytes: 256 * 1024,
  analysisTimeoutMs: 5 * 60_000,
  probeTimeoutMs: 20_000,
  // A CLI that cannot open the browser waits for nobody, so the spinner stops after this.
  signInTimeoutMs: 5 * 60_000,
  lookupTimeoutMs: 5_000,
  killGraceMs: 2_000,
}

export function cliLabel(provider: CliProviderId): string {
  return provider === 'claude-cli' ? 'Claude CLI' : 'Codex CLI'
}

export interface CliRunOptions {
  provider: CliProviderId
  command: string
  args: readonly string[]
  cwd: string
  env: Record<string, string>
  /** Written to stdin, which is then closed. Without input, stdin is closed at once. */
  input?: Buffer | null
  /** Line mode: called for each stdout line. A thrown ProviderError stops the process. */
  onLine?: (line: string) => void
  timeoutMs: number
  signal?: AbortSignal
  maxStdinBytes: number
  maxStdoutBytes: number
  maxStderrBytes: number
  maxLineBytes: number
  killGraceMs: number
  platform: NodeJS.Platform
  spawn: SpawnFunction
}

export interface CliRunResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  /** stdout in capture mode; empty in line mode. */
  stdout: string
  stderr: string
}

/** A fresh private folder (0700) for one run, deleted afterwards whatever happens. */
export async function withTempDir<T>(root: string, fn: (dir: string) => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'edikte-cli-'))
  try {
    await chmod(dir, 0o700)
    return await fn(dir)
  } finally {
    // A folder that cannot be deleted must not replace the run's own outcome.
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch((error: unknown) => {
      log.warn('cli', 'Could not delete a run folder', errorCode(error) || 'no error code')
    })
  }
}

/**
 * Runs a CLI without a shell. Enforces the size limits and the timeout, and
 * stops the process tree on cancel, timeout, an output limit or a ProviderError
 * thrown by `onLine`: SIGTERM first, SIGKILL after the grace period.
 */
export function runCli(options: CliRunOptions): Promise<CliRunResult> {
  const { provider } = options
  const label = cliLabel(provider)
  if (options.signal?.aborted) {
    return Promise.reject(new ProviderError(provider, 'cancelled', `${label} run cancelled`))
  }
  const input = options.input ?? null
  if (input && input.byteLength > options.maxStdinBytes) {
    return Promise.reject(
      new ProviderError(
        provider,
        'document_too_large',
        `Input of ${input.byteLength} bytes is over the ${label} limit of ${options.maxStdinBytes} bytes`,
      ),
    )
  }

  return new Promise<CliRunResult>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = options.spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        // Its own process group, so stopping it also stops the CLI's children.
        detached: options.platform !== 'win32',
      })
    } catch (error) {
      reject(spawnFailure(provider, error))
      return
    }

    const timers = new Set<NodeJS.Timeout>()
    const later = (ms: number, action: () => void): void => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        action()
      }, ms)
      timers.add(timer)
    }
    let settled = false
    let failure: ProviderError | null = null
    let terminating = false
    let exitCode: number | null = null
    let exitSignal: NodeJS.Signals | null = null
    let stdoutBytes = 0
    let stderrBytes = 0
    const captured: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let pending: Buffer[] = []
    let pendingBytes = 0

    const finish = (): void => {
      if (settled) return
      settled = true
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      options.signal?.removeEventListener('abort', onAbort)
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
      if (failure) {
        reject(failure)
        return
      }
      resolve({
        exitCode,
        signal: exitSignal,
        stdout: Buffer.concat(captured).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    }

    const terminate = (): void => {
      if (terminating) return
      terminating = true
      signalTree(child, 'SIGTERM', options)
      later(options.killGraceMs, () => {
        signalTree(child, 'SIGKILL', options)
        // Ends the run even if a grandchild keeps the output pipes open.
        later(options.killGraceMs, finish)
      })
    }

    const fail = (error: ProviderError): void => {
      if (settled || failure) return
      failure = error
      child.stdin?.destroy()
      terminate()
    }

    const onAbort = (): void => {
      fail(new ProviderError(provider, 'cancelled', `${label} run cancelled`))
    }

    const emitLine = (): void => {
      const line = Buffer.concat(pending, pendingBytes).toString('utf8').replace(/\r$/, '')
      pending = []
      pendingBytes = 0
      try {
        options.onLine?.(line)
      } catch (error) {
        fail(asProviderError(provider, error))
      }
    }

    const appendToLine = (piece: Buffer): boolean => {
      if (pendingBytes + piece.byteLength > options.maxLineBytes) {
        fail(
          new ProviderError(
            provider,
            'provider_invalid_output',
            `${label} wrote a line longer than ${options.maxLineBytes} bytes`,
          ),
        )
        return false
      }
      if (piece.byteLength > 0) {
        pending.push(piece)
        pendingBytes += piece.byteLength
      }
      return true
    }

    const flushLine = (): void => {
      if (options.onLine && pendingBytes > 0 && !failure && !settled) emitLine()
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled || failure) return
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > options.maxStdoutBytes) {
        fail(
          new ProviderError(
            provider,
            'provider_invalid_output',
            `${label} wrote more than ${options.maxStdoutBytes} bytes`,
          ),
        )
        return
      }
      if (!options.onLine) {
        captured.push(chunk)
        return
      }
      let start = 0
      let newline = chunk.indexOf(10)
      while (newline !== -1) {
        if (!appendToLine(chunk.subarray(start, newline))) return
        emitLine()
        if (failure) return
        start = newline + 1
        newline = chunk.indexOf(10, start)
      }
      appendToLine(chunk.subarray(start))
    })
    child.stdout?.on('end', flushLine)

    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled || failure) return
      stderrBytes += chunk.byteLength
      if (stderrBytes > options.maxStderrBytes) {
        fail(
          new ProviderError(
            provider,
            'provider_invalid_output',
            `${label} wrote more than ${options.maxStderrBytes} bytes to stderr`,
          ),
        )
        return
      }
      stderrChunks.push(chunk)
    })

    child.on('error', (error) => {
      if (child.pid === undefined) {
        failure ??= spawnFailure(provider, error)
        finish()
        return
      }
      fail(new ProviderError(provider, 'cli_failed', `${label} process error: ${error.message}`))
    })
    child.on('exit', (code, signal) => {
      exitCode = code
      exitSignal = signal
      // The pipes normally close right after exit; a leftover grandchild may hold them.
      later(options.killGraceMs, () => {
        flushLine()
        signalTree(child, 'SIGKILL', options)
        finish()
      })
    })
    child.on('close', (code, signal) => {
      exitCode ??= code
      exitSignal ??= signal
      finish()
    })

    child.stdin?.on('error', () => {
      // EPIPE when the CLI exits before reading all input; its exit status reports why.
    })
    if (input) child.stdin?.end(input)
    else child.stdin?.end()

    later(options.timeoutMs, () => {
      fail(
        new ProviderError(
          provider,
          'timeout',
          `${label} did not finish within ${Math.round(options.timeoutMs / 1000)} s`,
        ),
      )
    })
    options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function signalTree(
  child: ChildProcess,
  signal: 'SIGTERM' | 'SIGKILL',
  options: Pick<CliRunOptions, 'platform' | 'spawn' | 'env'>,
): void {
  const pid = child.pid
  if (pid === undefined) return
  if (options.platform === 'win32') {
    killTreeOnWindows(pid, child, signal === 'SIGKILL', options)
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Already gone.
    }
  }
}

/**
 * Windows has no SIGTERM, so both steps run `taskkill /T /F`: killing node.exe
 * alone would leave a codex.exe that codex.js started. The CLI itself is
 * killed directly when taskkill cannot start or fails, and after the last step.
 */
function killTreeOnWindows(
  pid: number,
  child: ChildProcess,
  lastStep: boolean,
  options: Pick<CliRunOptions, 'spawn' | 'env'>,
): void {
  const killChild = (): void => {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }
  const systemRoot = options.env.SystemRoot ?? 'C:\\Windows'
  try {
    const killer = options.spawn(
      win32.join(systemRoot, 'System32', 'taskkill.exe'),
      ['/T', '/F', '/PID', String(pid)],
      { stdio: 'ignore', windowsHide: true, shell: false },
    )
    killer.on('error', killChild)
    killer.on('exit', (code) => {
      if (code !== 0 || lastStep) killChild()
    })
  } catch {
    killChild()
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : ''
}

function spawnFailure(provider: CliProviderId, error: unknown): ProviderError {
  const code = errorCode(error)
  const label = cliLabel(provider)
  if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR') {
    return new ProviderError(provider, 'cli_not_found', `${label} could not be started (${code})`)
  }
  return new ProviderError(
    provider,
    'cli_failed',
    `${label} could not be started${code ? ` (${code})` : ''}`,
  )
}

function asProviderError(provider: CliProviderId, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error
  return new ProviderError(
    provider,
    'provider_invalid_output',
    error instanceof Error ? error.message : 'Unreadable CLI output',
  )
}
