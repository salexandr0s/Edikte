import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { CliProviderOptions } from '../../../src/main/ai/cli/cli-runtime'
import { defaultSpawn, type SpawnFunction } from '../../../src/main/ai/cli/process'
import { ProviderError } from '../../../src/main/ai/provider'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

export function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

export function fixtureLines(name: string): string[] {
  return readFixture(name)
    .split('\n')
    .filter((line) => line !== '')
}

/** The help text without the definition line of one flag, as an older CLI would print it. */
export function withoutFlag(help: string, flag: string): string {
  return help
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(flag))
    .join('\n')
}

export interface FakeAnswer {
  stdout?: string
  stderr?: string
  exitCode?: number
}

export interface FakeRun {
  /** Printed one per line after stdin is read. */
  lines?: string[]
  exitCode?: number
  stderr?: string
  /** Keeps running after the lines until it is killed. */
  hang?: boolean
  ignoreSigterm?: boolean
  /** codex exec: written to the -o file. Left out, no file is written. */
  answer?: string
}

export interface FakeScenario {
  version: string
  /** Printed for --help (claude) and exec --help (codex). */
  help: string
  /** Answers to auth status (claude) or login status (codex) in order; the last one repeats. */
  auth: FakeAnswer[]
  loginExitCode?: number
  run?: FakeRun
}

const CallSchema = z.object({
  kind: z.enum(['version', 'help', 'auth', 'login', 'print', 'exec']),
  args: z.array(z.string()),
  stdin: z.string().optional(),
  schema: z.string().nullable().optional(),
  images: z.array(z.object({ name: z.string(), bytes: z.number() })).optional(),
})
export type FakeCall = z.infer<typeof CallSchema>

export interface SpawnRecord {
  args: readonly string[]
  options: SpawnOptions
  child: ChildProcess
}

export interface FakeCli {
  home: string
  tempRoot: string
  binary: string
  spawns: SpawnRecord[]
  options: (overrides?: Partial<CliProviderOptions>) => CliProviderOptions
  calls: () => Promise<FakeCall[]>
  cleanup: () => Promise<void>
}

/** Variables a user may have set that must never reach a CLI. */
export const LEAKY_ENV = {
  ANTHROPIC_API_KEY: 'test-value',
  OPENAI_API_KEY: 'test-value',
  NODE_OPTIONS: '--require=./preload.js',
  CLAUDE_CONFIG_DIR: '/elsewhere',
}

/** Every variable a CLI run gets on macOS and Linux, sorted. */
export const POSIX_ENV_KEYS = [
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_AUTOUPDATER',
  'DISABLE_ERROR_REPORTING',
  'DISABLE_TELEMETRY',
  'HOME',
  'NO_COLOR',
  'PATH',
  'TMPDIR',
  'USER',
]

/**
 * A fake claude or codex binary: a shell script that runs fixtures/fake-cli.mjs
 * with this Node. Providers get it as the chosen path, so no test looks for or
 * starts a real CLI.
 */
export async function createFakeCli(scenario: FakeScenario): Promise<FakeCli> {
  const root = await mkdtemp(join(tmpdir(), 'edikte-cli-test-'))
  const home = join(root, 'home')
  const tempRoot = join(root, 'temp')
  await mkdir(home)
  await mkdir(tempRoot)
  const binary = join(home, 'fake-cli')
  const script = join(FIXTURES, 'fake-cli.mjs')
  await writeFile(binary, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, {
    mode: 0o755,
  })
  await writeFile(join(home, 'fake-cli.json'), JSON.stringify(scenario))
  const spawns: SpawnRecord[] = []
  const spawn: SpawnFunction = (command, args, options) => {
    const child = defaultSpawn(command, args, options)
    spawns.push({ args, options, child })
    return child
  }
  return {
    home,
    tempRoot,
    binary,
    spawns,
    options: (overrides = {}) => ({
      getOverridePath: () => binary,
      tempRoot,
      homeDir: home,
      env: { HOME: home, USER: 'tester', PATH: '/usr/bin:/bin', ...LEAKY_ENV },
      platform: process.platform,
      spawn,
      now: () => new Date('2026-11-04T09:00:00.000Z'),
      ...overrides,
      limits: { killGraceMs: 200, ...overrides.limits },
    }),
    calls: async () => {
      const text = await readFile(join(home, 'calls.jsonl'), 'utf8').catch(() => '')
      return text
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => CallSchema.parse(JSON.parse(line)))
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

/** The process of the analysis run: claude --print or codex exec. */
export function analysisPid(fake: FakeCli): number | undefined {
  return fake.spawns.find(
    (entry) => entry.args.includes('--print') || entry.args.includes('--output-schema'),
  )?.child.pid
}

export function isRunning(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function thrown(fn: () => unknown): ProviderError {
  try {
    fn()
  } catch (error) {
    if (error instanceof ProviderError) return error
    throw error
  }
  throw new Error('Expected a ProviderError')
}

export async function rejection(promise: Promise<unknown> | undefined): Promise<ProviderError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ProviderError) return error
    throw error
  }
  throw new Error('Expected a ProviderError')
}
