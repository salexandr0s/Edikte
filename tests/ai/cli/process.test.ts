import type { ChildProcess } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CLI_LIMITS,
  defaultSpawn,
  runCli,
  withTempDir,
  type CliRunOptions,
  type SpawnFunction,
} from '../../../src/main/ai/cli/process'
import { isRunning, rejection } from './fake-cli-harness'

const NODE = process.execPath
const HANG = 'setInterval(() => {}, 60000)'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edikte-run-test-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A short Node script plays the CLI. */
function options(script: string, overrides: Partial<CliRunOptions> = {}): CliRunOptions {
  return {
    provider: 'claude-cli',
    command: NODE,
    args: ['-e', script],
    cwd: dir,
    env: { HOME: dir, PATH: '/usr/bin:/bin' },
    timeoutMs: 10_000,
    maxStdinBytes: DEFAULT_CLI_LIMITS.maxStdinBytes,
    maxStdoutBytes: DEFAULT_CLI_LIMITS.maxStdoutBytes,
    maxStderrBytes: DEFAULT_CLI_LIMITS.maxStderrBytes,
    maxLineBytes: DEFAULT_CLI_LIMITS.maxLineBytes,
    killGraceMs: 200,
    platform: process.platform,
    spawn: defaultSpawn,
    ...overrides,
  }
}

describe.skipIf(process.platform === 'win32')('runCli', { timeout: 20_000 }, () => {
  it('passes each stdout line without CR, including a last line without newline', async () => {
    const lines: string[] = []
    const script = String.raw`process.stdout.write('one\r\ntwo\nthree')`
    const result = await runCli(options(script, { onLine: (line) => void lines.push(line) }))
    expect(lines).toEqual(['one', 'two', 'three'])
    expect(result.exitCode).toBe(0)
  })

  it('stops a CLI that writes a line over 1 MiB', async () => {
    const script = `process.stdout.write('x'.repeat(${DEFAULT_CLI_LIMITS.maxLineBytes + 1})); ${HANG}`
    const error = await rejection(runCli(options(script, { onLine: () => undefined })))
    expect(error.code).toBe('provider_invalid_output')
  })

  it.each(['stdout', 'stderr'] as const)(
    'stops a CLI that writes too much to %s',
    async (stream) => {
      const script = `process.${stream}.write('x'.repeat(5000)); ${HANG}`
      const limits = { maxStdoutBytes: 1000, maxStderrBytes: 1000 }
      const error = await rejection(runCli(options(script, limits)))
      expect(error.code).toBe('provider_invalid_output')
    },
  )

  it('stops the CLI and the processes it started when cancelled', async () => {
    const controller = new AbortController()
    const children: ChildProcess[] = []
    const grandchildren: number[] = []
    const script = `const child = require('node:child_process').spawn(process.execPath, ['-e', '${HANG}'], { stdio: 'ignore' }); console.log(child.pid); ${HANG}`
    const run = runCli(
      options(script, {
        signal: controller.signal,
        spawn: (command, args, spawnOptions) => {
          const child = defaultSpawn(command, args, spawnOptions)
          children.push(child)
          return child
        },
        onLine: (line) => {
          grandchildren.push(Number(line))
          controller.abort()
        },
      }),
    )
    expect((await rejection(run)).code).toBe('cancelled')
    expect(grandchildren[0]).toBeGreaterThan(0)
    expect(isRunning(children[0]?.pid)).toBe(false)
    await vi.waitFor(() => expect(isRunning(grandchildren[0])).toBe(false), { timeout: 5000 })
  })

  it('refuses input over the stdin limit without starting the CLI', async () => {
    const spawn = vi.fn<SpawnFunction>(defaultSpawn)
    const run = runCli(options('', { input: Buffer.alloc(2048), maxStdinBytes: 1024, spawn }))
    expect((await rejection(run)).code).toBe('document_too_large')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not start the CLI when the run is already cancelled', async () => {
    const spawn = vi.fn<SpawnFunction>(defaultSpawn)
    const run = runCli(options('', { signal: AbortSignal.abort(), spawn }))
    expect((await rejection(run)).code).toBe('cancelled')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a program that does not exist as not found', async () => {
    const run = runCli(options('', { command: join(dir, 'missing-cli') }))
    expect((await rejection(run)).code).toBe('cli_not_found')
  })

  it('on Windows, stops the tree with taskkill and then kills the CLI', async () => {
    const spawned: Array<{
      command: string
      args: readonly string[]
      detached: boolean | undefined
      pid: number | undefined
    }> = []
    const spawn: SpawnFunction = (command, args, spawnOptions) => {
      // taskkill gets a harmless stand-in; the CLI itself is a real process.
      const child = command.endsWith('taskkill.exe')
        ? defaultSpawn(NODE, ['-e', ''], { stdio: 'ignore' })
        : defaultSpawn(command, args, spawnOptions)
      spawned.push({ command, args, detached: spawnOptions.detached, pid: child.pid })
      return child
    }
    const env = { SystemRoot: 'C:\\Windows', PATH: '/usr/bin:/bin' }
    const run = runCli(options(HANG, { platform: 'win32', spawn, timeoutMs: 300, env }))
    expect((await rejection(run)).code).toBe('timeout')
    const [cli, taskkill] = spawned
    expect(cli?.detached).toBe(false)
    expect(taskkill).toMatchObject({
      command: 'C:\\Windows\\System32\\taskkill.exe',
      args: ['/T', '/F', '/PID', String(cli?.pid)],
    })
    expect(isRunning(cli?.pid)).toBe(false)
  })

  it('gives each run a private temp folder and deletes it afterwards, also after an error', async () => {
    let used = ''
    await withTempDir(dir, async (temp) => {
      used = temp
      expect((await stat(temp)).mode & 0o777).toBe(0o700)
    })
    await expect(stat(used)).rejects.toThrow()
    await expect(withTempDir(dir, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(readdir(dir)).resolves.toEqual([])
  })
})
