import { constants } from 'node:fs'
import { access, open, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { ProviderStatus } from '@shared/providers'
import { readVariable, type EnvSource } from './environment'

/**
 * Finds the claude or codex binary without ever running a shell alias: a
 * GUI-launched app does not inherit the shell PATH, and on some machines an
 * alias around `claude` edits ~/.claude.json.
 */

export type CliName = 'claude' | 'codex'
/** What a login shell may be asked to look up. */
type ProgramName = CliName | 'node'
export type BinaryPathSource = NonNullable<ProviderStatus['binaryPathSource']>

export interface ResolvedCli {
  /** The file the lookup found, as shown in Settings. */
  path: string
  source: BinaryPathSource
  /** Program to spawn, and arguments before the CLI's own (node and the script of an npm CLI). */
  command: string
  prefixArgs: readonly string[]
  /** Folders put first on the CLI's PATH: the found file's, and node's for a Node script. */
  pathDirs: readonly string[]
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
  /** Follows symlinks; rejects for a missing file. */
  realPath: (path: string) => Promise<string>
  /** Up to `maxBytes` from the start of a file, for its `#!` line. */
  readHead: (path: string, maxBytes: number) => Promise<Buffer>
  /** Runs a lookup helper (login shell, where.exe) directly, without a shell of our own. */
  runCommand: (
    command: string,
    args: readonly string[],
    env: Record<string, string>,
    timeoutMs: number,
  ) => Promise<LookupCommandResult>
  /** Once aborted, a failed helper run ends the lookup with its error instead of being skipped. */
  signal?: AbortSignal
}

const MAX_SHIM_BYTES = 64 * 1024
const MAX_SHEBANG_BYTES = 256
const NO_NODE = 'The CLI is a Node.js script, and no node program was found to run it'

export async function findCliBinary(
  name: CliName,
  overridePath: string | null,
  deps: BinaryLookupDeps,
): Promise<BinaryLookupResult> {
  if (overridePath) {
    // No fallback: the user chose this file, so a bad choice must stay visible.
    const found = await resolveCandidate(overridePath, 'override', deps)
    return found ?? { cli: null, detail: 'The chosen file is not a program that can be started' }
  }
  if (deps.platform === 'win32') return { cli: await findOnWindows(name, deps), detail: null }
  return (await findOnPosix(name, deps)) ?? { cli: null, detail: null }
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

async function findOnPosix(
  name: CliName,
  deps: BinaryLookupDeps,
): Promise<BinaryLookupResult | null> {
  for (const path of knownPosixLocations(name, deps.homeDir)) {
    if (await deps.isExecutableFile(path)) return posixCli(path, 'known_location', deps)
  }
  for (const dir of absolutePathEntries(deps)) {
    const path = posix.join(dir, name)
    if (await deps.isExecutableFile(path)) return posixCli(path, 'path', deps)
  }
  const fromShell = await loginShellLookup(name, deps)
  return fromShell ? posixCli(fromShell, 'login_shell', deps) : null
}

function absolutePathEntries(deps: BinaryLookupDeps): string[] {
  return (readVariable(deps.env, 'PATH', false) ?? '')
    .split(':')
    .filter((dir) => posix.isAbsolute(dir))
}

/**
 * npm installs a CLI as a symlink to a `#!/usr/bin/env node` script, and an
 * app started from the Finder has no node on its PATH. Such a script runs as
 * `node <script>`, with a node found the way the CLI itself is found.
 */
async function posixCli(
  path: string,
  source: BinaryPathSource,
  deps: BinaryLookupDeps,
): Promise<BinaryLookupResult> {
  const script = await readNodeScript(path, deps)
  if (!script) return { cli: direct(path, source, deps.platform), detail: null }
  const node = await findNode(path, script.realPath, deps)
  if (!node) return { cli: null, detail: NO_NODE }
  return {
    cli: {
      path,
      source,
      command: node,
      prefixArgs: [...script.nodeArgs, script.realPath],
      pathDirs: [posix.dirname(node), posix.dirname(path)],
    },
    detail: null,
  }
}

async function readNodeScript(
  path: string,
  deps: BinaryLookupDeps,
): Promise<{ realPath: string; nodeArgs: string[] } | null> {
  try {
    const realPath = await deps.realPath(path)
    const head = await deps.readHead(realPath, MAX_SHEBANG_BYTES)
    const nodeArgs = parseNodeShebang(head.toString('utf8'))
    return nodeArgs ? { realPath, nodeArgs } : null
  } catch {
    return null
  }
}

/**
 * The node options of an `env node` first line (`#!/usr/bin/env node`,
 * `#!/usr/bin/env -S node --no-warnings`), or null for any other first line.
 */
export function parseNodeShebang(head: string): string[] | null {
  const line = (head.split('\n', 1)[0] ?? '').trimEnd()
  const words = /^#!\s*\/\S*\/env\s+(.+)$/.exec(line)?.[1]?.split(/\s+/) ?? []
  if (words[0] === '-S') words.shift()
  if (words[0] !== 'node') return null
  const options = words.slice(1)
  return options.every((word) => word.startsWith('-')) ? options : null
}

/**
 * The node for a script: next to the found file or the script, in the
 * script's npm prefix, at the usual install folders, on PATH, and last
 * through a login shell.
 */
async function findNode(
  path: string,
  realPath: string,
  deps: BinaryLookupDeps,
): Promise<string | null> {
  const prefix = /^(.*?)\/lib\/node_modules\//.exec(realPath)?.[1]
  const candidates = [
    posix.join(posix.dirname(path), 'node'),
    posix.join(posix.dirname(realPath), 'node'),
    ...(prefix ? [posix.join(prefix, 'bin', 'node')] : []),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    posix.join(deps.homeDir, '.volta', 'bin', 'node'),
    ...absolutePathEntries(deps).map((dir) => posix.join(dir, 'node')),
  ]
  for (const candidate of new Set(candidates)) {
    if (await deps.isExecutableFile(candidate)) return candidate
  }
  return loginShellLookup('node', deps)
}

/** `whence -p` and `type -P` search PATH only; they never expand an alias or function. */
export function loginShellCommands(
  name: ProgramName,
  shell: string | undefined,
): Array<{ command: string; args: string[] }> {
  const zsh = { command: '/bin/zsh', args: ['-l', '-c', `whence -p ${name}`] }
  const bash = { command: '/bin/bash', args: ['-l', '-c', `type -P ${name}`] }
  return shell?.endsWith('/bash') ? [bash, zsh] : [zsh, bash]
}

async function loginShellLookup(name: ProgramName, deps: BinaryLookupDeps): Promise<string | null> {
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
    } catch (error) {
      // A slow or broken shell profile only means this step finds nothing; a cancel ends the lookup.
      if (deps.signal?.aborted) throw error
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
  if (await deps.isExecutableFile(known)) return direct(known, 'known_location', deps.platform)
  for (const candidate of await whereExe(name, deps)) {
    const found = await resolveCandidate(candidate, 'path', deps)
    if (found?.cli) return found.cli
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
  } catch (error) {
    if (deps.signal?.aborted) throw error
    return []
  }
}

/** The CLI behind a path, or null when the path is not a program that can be started. */
async function resolveCandidate(
  path: string,
  source: BinaryPathSource,
  deps: BinaryLookupDeps,
): Promise<BinaryLookupResult | null> {
  if (deps.platform !== 'win32') {
    return posix.isAbsolute(path) && (await deps.isExecutableFile(path))
      ? posixCli(path, source, deps)
      : null
  }
  if (!win32.isAbsolute(path)) return null
  const extension = win32.extname(path).toLowerCase()
  if (extension === '.exe') {
    return (await deps.isExecutableFile(path))
      ? { cli: direct(path, source, deps.platform), detail: null }
      : null
  }
  if (extension !== '.cmd') return null
  // Node refuses .cmd files without shell: true, and cmd.exe quoting would mangle
  // the JSON arguments, so the shim's target runs directly instead.
  const target = await resolveCmdShim(path, deps)
  return target ? { cli: { path, source, ...target }, detail: null } : null
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
): Promise<Pick<ResolvedCli, 'command' | 'prefixArgs' | 'pathDirs'> | null> {
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
  if (/\.exe$/i.test(entry)) return { command: entry, prefixArgs: [], pathDirs: [shimDir] }
  if (!/\.[cm]?js$/i.test(entry)) return null
  const node = await findWindowsNode(shimDir, deps)
  return node
    ? { command: node, prefixArgs: [entry], pathDirs: [win32.dirname(node), shimDir] }
    : null
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

function direct(path: string, source: BinaryPathSource, platform: NodeJS.Platform): ResolvedCli {
  const dir = platform === 'win32' ? win32.dirname(path) : posix.dirname(path)
  return { path, source, command: path, prefixArgs: [], pathDirs: [dir] }
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

/** The first bytes of a file, without reading a large binary whole. */
export async function readFileHead(path: string, maxBytes: number): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}
