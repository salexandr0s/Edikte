import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CLAUDE_ISOLATION_ARGS,
  buildClaudeAnalysisArgs,
  encodeClaudeInput,
} from '../../../src/main/ai/cli/claude-protocol'
import { createClaudeCliProvider } from '../../../src/main/ai/cli/claude-provider'
import type { AnalysisRequest } from '../../../src/main/ai/provider'
import {
  POSIX_ENV_KEYS,
  analysisPid,
  createFakeCli,
  fixtureLines,
  isRunning,
  readFixture,
  rejection,
  withoutFlag,
  type FakeAnswer,
  type FakeCli,
  type FakeScenario,
} from './fake-cli-harness'

const SUBSCRIPTION = {
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'person@example.com',
  orgId: '00000000-0000-4000-8000-000000000001',
  orgName: 'Example',
  subscriptionType: 'max',
}
const OTHER_ACCOUNT = {
  ...SUBSCRIPTION,
  email: 'other@example.com',
  orgId: '00000000-0000-4000-8000-000000000002',
}
const API_ACCOUNT = {
  loggedIn: true,
  authMethod: 'console',
  apiProvider: 'firstParty',
  email: 'person@example.com',
  orgId: '00000000-0000-4000-8000-000000000003',
  orgName: 'Example',
}
const status = (fields: object, exitCode = 0): FakeAnswer => ({
  stdout: `${JSON.stringify(fields, null, 2)}\n`,
  exitCode,
})
const SIGNED_OUT = status({ loggedIn: false }, 1)
const INIT = JSON.stringify({
  type: 'system',
  subtype: 'init',
  tools: ['StructuredOutput'],
  mcp_servers: [],
  plugins: [],
  skills: [],
})

const REQUEST: AnalysisRequest = {
  model: 'default',
  system: 'Extract the facts of the appraisal as JSON.',
  content: [
    { type: 'text', text: 'Seite 1: Eigentumswohnung, 74 m², Schätzwert 250.000 EUR' },
    { type: 'image', mediaType: 'image/jpeg', data: Buffer.from('jpeg-page-2'), page: 2 },
  ],
  jsonSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  },
  schemaName: 'facts',
  maxOutputTokens: 4096,
}

const signal = (): AbortSignal => new AbortController().signal

let fake: FakeCli | null = null
afterEach(async () => {
  await fake?.cleanup()
  fake = null
})

async function setup(scenario: Partial<FakeScenario> = {}): Promise<FakeCli> {
  fake = await createFakeCli({
    version: '2.1.226 (Claude Code)',
    help: readFixture('claude-help.txt'),
    subcommandHelp: {
      'auth status': readFixture('claude-auth-status-help.txt'),
      'auth login': readFixture('claude-auth-login-help.txt'),
    },
    auth: [status(SUBSCRIPTION)],
    ...scenario,
  })
  return fake
}

describe.skipIf(process.platform === 'win32')('Claude CLI provider', { timeout: 20_000 }, () => {
  it('detects a signed-in CLI, running it with a whitelisted environment in private folders', async () => {
    const cli = await setup()
    await expect(createClaudeCliProvider(cli.options()).detect()).resolves.toEqual({
      id: 'claude-cli',
      state: 'ready',
      version: '2.1.226',
      binaryPath: cli.binary,
      binaryPathSource: 'override',
      accountLabel: 'person@example.com',
      plan: 'Max',
      detail: null,
      checkedAt: '2026-11-04T09:00:00.000Z',
    })
    // --version, --help, auth status --help, auth login --help and auth status.
    expect(cli.spawns).toHaveLength(5)
    for (const { options } of cli.spawns) {
      expect(Object.keys(options.env ?? {}).sort()).toEqual(POSIX_ENV_KEYS)
      expect(options.env?.PATH).toBe(`${cli.home}:/usr/bin:/bin`)
      expect(options.env?.TMPDIR).toBe(options.cwd)
      expect(String(options.cwd).startsWith(join(cli.tempRoot, 'edikte-cli-'))).toBe(true)
    }
    await expect(readdir(cli.tempRoot)).resolves.toEqual([])
    const authCall = (await cli.calls()).find((call) => call.kind === 'auth')
    expect(authCall?.args).toEqual([...CLAUDE_ISOLATION_ARGS, 'auth', 'status', '--json'])
  })

  it('reports a CLI without a needed flag as update required and does not analyze', async () => {
    const cli = await setup({ help: withoutFlag(readFixture('claude-help.txt'), '--safe-mode') })
    const provider = createClaudeCliProvider(cli.options())
    await expect(provider.detect()).resolves.toMatchObject({
      state: 'update_required',
      version: '2.1.226',
      detail: 'Missing flags: --safe-mode',
    })
    expect((await rejection(provider.analyze(REQUEST, signal()))).code).toBe('cli_update_required')
    const kinds = (await cli.calls()).map((call) => call.kind)
    // Three help texts, read once for the version.
    expect(kinds.filter((kind) => kind === 'help')).toHaveLength(3)
    expect(kinds).not.toContain('auth')
    expect(kinds).not.toContain('print')
  })

  it('reports a chosen file that does not exist as not installed', async () => {
    const cli = await setup()
    const provider = createClaudeCliProvider(
      cli.options({ getOverridePath: () => join(cli.home, 'missing') }),
    )
    await expect(provider.detect()).resolves.toMatchObject({
      state: 'not_installed',
      detail: 'The chosen file is not a program that can be started',
    })
    expect(cli.spawns).toHaveLength(0)
  })

  it('reports a signed-out CLI', async () => {
    const cli = await setup({ auth: [SIGNED_OUT] })
    await expect(createClaudeCliProvider(cli.options()).detect()).resolves.toMatchObject({
      state: 'signed_out',
      accountLabel: null,
    })
  })

  it.each([
    { account: 'a Claude subscription', fields: SUBSCRIPTION, costUsd: null },
    { account: 'an API account', fields: API_ACCOUNT, costUsd: 0.0014199999999999998 },
  ])('analyzes with $account', async ({ fields, costUsd }) => {
    const cli = await setup({
      auth: [status(fields)],
      run: { lines: fixtureLines('claude-run-success.jsonl') },
    })
    const provider = createClaudeCliProvider(cli.options())
    await expect(provider.analyze(REQUEST, signal())).resolves.toMatchObject({
      json: { ok: true },
      usage: { inputTokens: 905, outputTokens: 103, costUsd },
      model: 'claude-haiku-4-5-20251001',
      accountLabel: 'person@example.com',
    })
    const print = (await cli.calls()).find((call) => call.kind === 'print')
    expect(print?.args).toEqual(buildClaudeAnalysisArgs(REQUEST))
    expect(print?.stdin).toBe(encodeClaudeInput(REQUEST.content).toString('utf8'))
    await expect(readdir(cli.tempRoot)).resolves.toEqual([])
  })

  it('fails when the account changes during the analysis', async () => {
    const cli = await setup({
      auth: [status(SUBSCRIPTION), status(OTHER_ACCOUNT)],
      run: { lines: fixtureLines('claude-run-success.jsonl') },
    })
    const error = await rejection(createClaudeCliProvider(cli.options()).analyze(REQUEST, signal()))
    expect(error.code).toBe('provider_account_changed')
  })

  it('does not analyze under another account than the last check saw', async () => {
    const cli = await setup({ auth: [status(SUBSCRIPTION), status(OTHER_ACCOUNT)] })
    const provider = createClaudeCliProvider(cli.options())
    await expect(provider.detect()).resolves.toMatchObject({ state: 'ready' })
    expect((await rejection(provider.analyze(REQUEST, signal()))).code).toBe(
      'provider_account_changed',
    )
    expect((await cli.calls()).map((call) => call.kind)).not.toContain('print')
  })

  it('stops the run at a system/init line that offers tools', async () => {
    const init = JSON.stringify({
      type: 'system',
      subtype: 'init',
      tools: ['Bash', 'StructuredOutput'],
      mcp_servers: [],
      plugins: [],
      skills: [],
    })
    const cli = await setup({ run: { lines: [init], hang: true } })
    const error = await rejection(createClaudeCliProvider(cli.options()).analyze(REQUEST, signal()))
    expect(error.code).toBe('provider_invalid_output')
    expect(isRunning(analysisPid(cli))).toBe(false)
  })

  it('stops a run that takes too long', async () => {
    const cli = await setup({ run: { hang: true } })
    const provider = createClaudeCliProvider(cli.options({ limits: { analysisTimeoutMs: 500 } }))
    expect((await rejection(provider.analyze(REQUEST, signal()))).code).toBe('timeout')
    expect(isRunning(analysisPid(cli))).toBe(false)
  })

  async function cancelDuringRun(ignoreSigterm: boolean) {
    const cli = await setup({ run: { lines: [INIT], hang: true, ignoreSigterm } })
    const controller = new AbortController()
    let abortedAt = 0
    const analysis = createClaudeCliProvider(cli.options()).analyze(
      REQUEST,
      controller.signal,
      (event) => {
        if (event.phase !== 'waiting') return
        abortedAt = Date.now()
        controller.abort()
      },
    )
    const error = await rejection(analysis)
    return { code: error.code, waitedMs: Date.now() - abortedAt, pid: analysisPid(cli) }
  }

  it('cancels a running analysis', async () => {
    const { code, pid } = await cancelDuringRun(false)
    expect(code).toBe('cancelled')
    expect(isRunning(pid)).toBe(false)
  })

  it('kills a CLI that ignores SIGTERM once the grace period is over', async () => {
    const { code, waitedMs, pid } = await cancelDuringRun(true)
    expect(code).toBe('cancelled')
    expect(waitedMs).toBeGreaterThanOrEqual(150)
    expect(isRunning(pid)).toBe(false)
  })

  it('runs one job at a time, and disconnect cancels the running one', async () => {
    const cli = await setup({ run: { lines: [INIT], hang: true } })
    const provider = createClaudeCliProvider(cli.options())
    const started = Promise.withResolvers<void>()
    const first = rejection(provider.analyze(REQUEST, signal(), () => started.resolve()))
    // A first job that fails early fails the busy check below instead of hanging the test.
    await Promise.race([started.promise, first])
    expect((await rejection(provider.analyze(REQUEST, signal()))).code).toBe('busy')
    await provider.disconnect?.()
    expect((await first).code).toBe('cancelled')
  })

  it('signs in with the CLI and then reports the account', async () => {
    const cli = await setup({ auth: [SIGNED_OUT, status(SUBSCRIPTION)] })
    const provider = createClaudeCliProvider(cli.options())
    await expect(provider.detect()).resolves.toMatchObject({ state: 'signed_out' })
    await expect(provider.connect?.(signal())).resolves.toMatchObject({
      state: 'ready',
      accountLabel: 'person@example.com',
    })
    const login = (await cli.calls()).find((call) => call.kind === 'login')
    expect(login?.args).toEqual([...CLAUDE_ISOLATION_ARGS, 'auth', 'login', '--claudeai'])
  })

  it('reports a failed sign-in with a short reason and without the sign-in link', async () => {
    const cli = await setup({
      auth: [SIGNED_OUT],
      loginExitCode: 1,
      loginStderr:
        'Error: no browser opened https://claude.ai/oauth/authorize?state=abcdefghijklmnopqrstuvwxyz123456\n',
    })
    const provider = createClaudeCliProvider(cli.options())
    const error = await rejection(provider.connect?.(signal()))
    expect(error.code).toBe('provider_auth')
    expect(error.message).toContain('sign-in exited with code 1: Error: no browser opened [link]')
    expect(error.message).not.toContain('state=')
  })

  it('reports a CLI whose sign-in lacks --claudeai as update required', async () => {
    const loginHelp = readFixture('claude-auth-login-help.txt')
    const cli = await setup({
      subcommandHelp: {
        'auth status': readFixture('claude-auth-status-help.txt'),
        'auth login': withoutFlag(loginHelp, '--claudeai'),
      },
    })
    await expect(createClaudeCliProvider(cli.options()).detect()).resolves.toMatchObject({
      state: 'update_required',
      detail: 'Missing flags: --claudeai',
    })
  })
})
