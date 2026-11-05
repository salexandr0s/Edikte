import { posix, win32 } from 'node:path'

/** Set for every CLI run: no colour codes, no self-update, no telemetry or error reports. */
export const FIXED_CLI_ENV: Readonly<Record<string, string>> = {
  NO_COLOR: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
}

const WINDOWS_PASSTHROUGH = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot'] as const

export type EnvSource = Readonly<Record<string, string | undefined>>

export interface CliEnvironmentInput {
  source: EnvSource
  platform: NodeJS.Platform
  homeDir: string
  /** The run's private temp folder, used as TMPDIR (and TEMP on Windows). */
  tempDir: string
  /** Folders put first on PATH: the binary's, and node's for a Node script, so its children find node. */
  programDirs: readonly string[]
}

/**
 * The complete environment of a CLI run, built from a whitelist. API keys
 * (ANTHROPIC_API_KEY, OPENAI_API_KEY) and NODE_OPTIONS never reach the CLI,
 * so it signs in with its own account.
 */
export function buildCliEnvironment(input: CliEnvironmentInput): Record<string, string> {
  const windows = input.platform === 'win32'
  const read = (name: string): string | undefined => readVariable(input.source, name, windows)
  const env: Record<string, string> = {}
  const home = read('HOME') ?? (windows ? undefined : input.homeDir)
  if (home) env.HOME = home
  const user = read('USER')
  if (user) env.USER = user
  env.PATH = joinPathList(
    [...input.programDirs, ...(read('PATH') ?? '').split(windows ? ';' : ':')],
    windows,
  )
  env.TMPDIR = input.tempDir
  if (windows) {
    for (const name of WINDOWS_PASSTHROUGH) {
      const value = read(name)
      if (value) env[name] = value
    }
    env.TEMP = input.tempDir
  }
  return { ...env, ...FIXED_CLI_ENV }
}

/** Reads a variable; Windows names are case-insensitive (`Path`, `PATH`). */
export function readVariable(
  source: EnvSource,
  name: string,
  caseInsensitive: boolean,
): string | undefined {
  let value = source[name]
  if (value === undefined && caseInsensitive) {
    const key = Object.keys(source).find((entry) => entry.toUpperCase() === name.toUpperCase())
    value = key === undefined ? undefined : source[key]
  }
  return value === '' ? undefined : value
}

/** Absolute entries only: a relative entry would resolve against the CLI's working folder. */
function joinPathList(entries: ReadonlyArray<string | null>, windows: boolean): string {
  const path = windows ? win32 : posix
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    if (!entry || !path.isAbsolute(entry)) continue
    const key = windows ? entry.toLowerCase() : entry
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry)
  }
  return result.join(windows ? ';' : ':')
}
