import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { ProviderStatus } from '@shared/providers'
import { readVariable, type EnvSource } from './environment'

/**
 * Finds the claude or codex binary without ever running a shell alias: a
 * GUI-launched app does not inherit the shell PATH, and on some machines an
 * alias around `claude` edits ~/.claude.json.
 */

export type CliName = 'claude' | 'codex'
export type BinaryPathSource = NonNullable<ProviderStatus['binaryPathSource']>

export interface ResolvedCli {
  /** The file the lookup found, as shown in Settings. */
  path: string
  source: BinaryPathSource
  /** Program to spawn, and arguments before the CLI's own (the JS entry of an npm shim). */
  command: string
  prefixArgs: readonly string[]
}

export interface BinaryLookupResult {
  cli: ResolvedCli | null
  /** Why nothing usable was found, for the Settings detail line. */
  detail: string | null
}

export interface LookupCommandResult {
  exitCode: number | null
  stdout: string
}

export interface BinaryLookupDeps {
  platform: NodeJS.Platform
  env: EnvSource
  homeDir: string
  timeoutMs: number
  isExecutableFile: (path: string) => Promise<boolean>
  readTextFile: (path: string) => Promise<string>
  /** Runs a lookup helper (login shell, where.exe) directly, without a shell of our own. */
  runCommand: (
    command: string,
    args: readonly string[],
    env: Record<string, string>,
    timeoutMs: number,
  ) => Promise<LookupCommandResult>
}

const MAX_SHIM_BYTES = 64 * 1024

export async function findCliBinary(
  name: CliName,
  overridePath: string | null,
  deps: BinaryLookupDeps,
): Promise<BinaryLookupResult> {
  if (overridePath) {
    // No fallback: the user chose this file, so a bad choice must stay visible.
    const cli = await resolveCandidate(overridePath, 'override', deps)
    return cli
      ? { cli, detail: null }
      : { cli: null, detail: 'The chosen file is not a program that can be started' }
  }
  const cli =
    deps.platform === 'win32' ? await findOnWindows(name, deps) : await findOnPosix(name, deps)
  return { cli, detail: null }
}

export function knownPosixLocations(name: CliName, homeDir: string): string[] {
  const locations = [
    posix.join(homeDir, '.local', 'bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]
  if (name === 'claude') locations.push(posix.join(homeDir, '.claude', 'local', 'claude'))
  return locations
}

async function findOnPosix(name: CliName, deps: BinaryLookupDeps): Promise<ResolvedCli | null> {
  for (const path of knownPosixLocations(name, deps.homeDir)) {
    if (await deps.isExecutableFile(path)) return direct(path, 'known_location')
  }
  for (const dir of (readVariable(deps.env, 'PATH', false) ?? '').split(':')) {
    if (!posix.isAbsolute(dir)) continue
    const path = posix.join(dir, name)
    if (await deps.isExecutableFile(path)) return direct(path, 'path')
  }
  const fromShell = await loginShellLookup(name, deps)
  return fromShell ? direct(fromShell, 'login_shell') : null
}

/** `whence -p` and `type -P` search PATH only; they never expand an alias or function. */
export function loginShellCommands(
  name: CliName,
  shell: string | undefined,
): Array<{ command: string; args: string[] }> {
  const zsh = { command: '/bin/zsh', args: ['-l', '-c', `whence -p ${name}`] }
  const bash = { command: '/bin/bash', args: ['-l', '-c', `type -P ${name}`] }
  return shell?.endsWith('/bash') ? [bash, zsh] : [zsh, bash]
}

async function loginShellLookup(name: CliName, deps: BinaryLookupDeps): Promise<string | null> {
  const env: Record<string, string> = {
    HOME: readVariable(deps.env, 'HOME', false) ?? deps.homeDir,
    PATH: readVariable(deps.env, 'PATH', false) ?? '/usr/bin:/bin:/usr/sbin:/sbin',
  }
  for (const key of ['USER', 'LOGNAME', 'TMPDIR']) {
    const value = readVariable(deps.env, key, false)
    if (value) env[key] = value
  }
  for (const { command, args } of loginShellCommands(
    name,
    readVariable(deps.env, 'SHELL', false),
  )) {
    if (!(await deps.isExecutableFile(command))) continue
    try {
      const result = await deps.runCommand(command, args, env, deps.timeoutMs)
      if (result.exitCode !== 0) continue
      const path = await acceptLoginShellOutput(result.stdout, deps.isExecutableFile)
      if (path) return path
    } catch {
      // A slow or broken shell profile only means this step finds nothing.
    }
  }
  return null
}

/** Profiles may print text first, so only the last line counts, and only as an absolute executable path. */
export async function acceptLoginShellOutput(
  stdout: string,
  isExecutableFile: (path: string) => Promise<boolean>,
): Promise<string | null> {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const candidate = lines.at(-1)
  if (!candidate || !posix.isAbsolute(candidate)) return null
  return (await isExecutableFile(candidate)) ? candidate : null
}

async function findOnWindows(name: CliName, deps: BinaryLookupDeps): Promise<ResolvedCli | null> {
  const profile = readVariable(deps.env, 'USERPROFILE', true) ?? deps.homeDir
  const known = win32.join(profile, '.local', 'bin', `${name}.exe`)
  if (await deps.isExecutableFile(known)) return direct(known, 'known_location')
  for (const candidate of await whereExe(name, deps)) {
    const cli = await resolveCandidate(candidate, 'path', deps)
    if (cli) return cli
  }
  return null
}

async function whereExe(name: string, deps: BinaryLookupDeps): Promise<string[]> {
  const systemRoot = readVariable(deps.env, 'SystemRoot', true) ?? 'C:\\Windows'
  const env: Record<string, string> = { SystemRoot: systemRoot }
  for (const key of ['PATH', 'PATHEXT']) {
    const value = readVariable(deps.env, key, true)
    if (value) env[key] = value
  }
  try {
    const result = await deps.runCommand(
      win32.join(systemRoot, 'System32', 'where.exe'),
      [name],
      env,
      deps.timeoutMs,
    )
    if (result.exitCode !== 0) return []
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => win32.isAbsolute(line))
  } catch {
    return []
  }
}

async function resolveCandidate(
  path: string,
  source: BinaryPathSource,
  deps: BinaryLookupDeps,
): Promise<ResolvedCli | null> {
  if (deps.platform !== 'win32') {
    return posix.isAbsolute(path) && (await deps.isExecutableFile(path))
      ? direct(path, source)
      : null
  }
  if (!win32.isAbsolute(path)) return null
  const extension = win32.extname(path).toLowerCase()
  if (extension === '.exe') return (await deps.isExecutableFile(path)) ? direct(path, source) : null
  if (extension !== '.cmd') return null
  // Node refuses .cmd files without shell: true, and cmd.exe quoting would mangle
  // the JSON arguments, so the shim's target runs directly instead.
  const target = await resolveCmdShim(path, deps)
  return target ? { path, source, ...target } : null
}

/**
 * The script an npm `.cmd` shim starts, relative to the shim's folder. Handles
 * the current cmd-shim format (`"%dp0%\…\cli.js" %*`) and the older one
 * (`"%~dp0\…\cli.js" %*`); the node.exe candidate is never the target.
 */
export function parseCmdShimTarget(text: string): string | null {
  let target: string | null = null
  for (const match of text.matchAll(/"%~?dp0%?\\([^"%\r\n]+)"\s*%\*/gi)) {
    const candidate = match[1]
    if (candidate && !/(?:^|\\)node\.exe$/i.test(candidate)) target = candidate
  }
  return target
}

async function resolveCmdShim(
  shimPath: string,
  deps: BinaryLookupDeps,
): Promise<{ command: string; prefixArgs: string[] } | null> {
  let text: string
  try {
    text = await deps.readTextFile(shimPath)
  } catch {
    return null
  }
  if (text.length > MAX_SHIM_BYTES) return null
  const target = parseCmdShimTarget(text)
  if (!target) return null
  const shimDir = win32.dirname(shimPath)
  const entry = win32.resolve(shimDir, target)
  if (!(await deps.isExecutableFile(entry))) return null
  if (/\.exe$/i.test(entry)) return { command: entry, prefixArgs: [] }
  if (!/\.[cm]?js$/i.test(entry)) return null
  const node = await findWindowsNode(shimDir, deps)
  return node ? { command: node, prefixArgs: [entry] } : null
}

/** The shim prefers node.exe next to itself and falls back to the node on PATH. */
async function findWindowsNode(shimDir: string, deps: BinaryLookupDeps): Promise<string | null> {
  const local = win32.join(shimDir, 'node.exe')
  if (await deps.isExecutableFile(local)) return local
  for (const candidate of await whereExe('node', deps)) {
    if (/\.exe$/i.test(candidate) && (await deps.isExecutableFile(candidate))) return candidate
  }
  return null
}

function direct(path: string, source: BinaryPathSource): ResolvedCli {
  return { path, source, command: path, prefixArgs: [] }
}

/** A regular file the current user may execute (on Windows: a regular file). */
export async function isExecutableFile(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    if (platform !== 'win32') await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
