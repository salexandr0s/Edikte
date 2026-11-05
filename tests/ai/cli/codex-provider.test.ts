import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CODEX_FRAMING,
  codexFeaturesToDisable,
  parseCodexFeatures,
} from '../../../src/main/ai/cli/codex-protocol'
import { createCodexCliProvider } from '../../../src/main/ai/cli/codex-provider'
import type { AnalysisRequest } from '../../../src/main/ai/provider'
import {
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

const SIGNED_IN: FakeAnswer = { stderr: 'Logged in using ChatGPT\n' }
const API_KEY: FakeAnswer = { stderr: 'Logged in using an API key - sk-proj-***ABCD\n' }
const SIGNED_OUT: FakeAnswer = { stderr: 'Not logged in\n', exitCode: 1 }
const HELP = readFixture('codex-exec-help.txt')
const FEATURES = readFixture('codex-features-list-0.154.0.txt')
/** The exact list is pinned in codex-protocol.test.ts. */
const DISABLED = codexFeaturesToDisable(parseCodexFeatures(FEATURES)) ?? []
const SUCCESS = fixtureLines('codex-run-success-synthetic.jsonl')

const REQUEST: AnalysisRequest = {
  model: 'gpt-5.5',
  system: 'Extract the facts of the appraisal as JSON.',
  content: [
    { type: 'text', text: 'Seite 1: Eigentumswohnung, 74 m²' },
    { type: 'image', mediaType: 'image/jpeg', data: Buffer.from('jpeg-page-2'), page: 2 },
    { type: 'image', mediaType: 'image/jpeg', data: Buffer.from('jpeg-page-five'), page: 5 },
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
    version: 'codex-cli 0.154.0',
    help: HELP,
    features: FEATURES,
    stuckFeatures: ['unified_exec'],
    auth: [SIGNED_IN],
    ...scenario,
  })
  return fake
}

describe.skipIf(process.platform === 'win32')('Codex CLI provider', { timeout: 20_000 }, () => {
  it.each([
    {
      name: 'a signed-in CLI',
      scenario: {},
      expected: { state: 'ready', version: '0.154.0', plan: 'ChatGPT', accountLabel: null },
    },
    {
      name: 'a signed-out CLI',
      scenario: { auth: [SIGNED_OUT] },
      expected: { state: 'signed_out' },
    },
    {
      name: 'a CLI without --ignore-rules',
      scenario: { help: withoutFlag(HELP, '--ignore-rules') },
      expected: { state: 'update_required', detail: 'Missing flags: --ignore-rules' },
    },
    {
      name: 'a CLI whose feature list fails',
      scenario: { featuresExitCode: 2 },
      expected: { state: 'update_required', detail: 'codex features list exited with code 2' },
    },
    {
      name: 'a CLI that does not list the shell features',
      scenario: { features: FEATURES.replace(/^shell_tool .*$/m, '') },
      expected: {
        state: 'update_required',
        detail: 'codex features list lacks shell_tool or unified_exec',
      },
    },
    {
      name: 'a CLI that keeps shell_tool on despite --disable',
      scenario: { stuckFeatures: ['shell_tool', 'unified_exec'] },
      expected: { state: 'update_required', detail: 'codex --disable shell_tool has no effect' },
    },
  ])('detects $name', async ({ scenario, expected }) => {
    const cli = await setup(scenario)
    await expect(createCodexCliProvider(cli.options()).detect()).resolves.toMatchObject(expected)
  })

  it('analyzes with the images as files in a private folder and reads the answer file', async () => {
    const cli = await setup({ run: { lines: SUCCESS, answer: '{"ok":true}' } })
    await expect(
      createCodexCliProvider(cli.options()).analyze(REQUEST, signal()),
    ).resolves.toMatchObject({
      json: { ok: true },
      usage: { inputTokens: 3150, outputTokens: 42, costUsd: null },
      model: 'gpt-5.5',
      accountLabel: null,
    })
    const calls = await cli.calls()
    // Read and checked once per version, by the version check; the run uses the kept list.
    expect(calls.filter((call) => call.kind === 'features')).toHaveLength(2)
    const exec = calls.find((call) => call.kind === 'exec')
    const dir = exec?.args[exec.args.indexOf('-C') + 1] ?? ''
    expect(dir.startsWith(join(cli.tempRoot, 'edikte-cli-'))).toBe(true)
    expect(exec?.args).toEqual([
      'exec',
      '--json',
      '-i',
      'image-1-page-2.jpg',
      '-i',
      'image-2-page-5.jpg',
      '--output-schema',
      join(dir, 'output-schema.json'),
      '-o',
      join(dir, 'answer.json'),
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      ...DISABLED.flatMap((name) => ['--disable', name]),
      '-C',
      dir,
      '-m',
      'gpt-5.5',
      '-',
    ])
    expect(exec?.images).toEqual([
      { name: 'image-1-page-2.jpg', bytes: 11 },
      { name: 'image-2-page-5.jpg', bytes: 14 },
    ])
    expect(exec?.schema).toBe(JSON.stringify(REQUEST.jsonSchema))
    expect(exec?.stdin?.startsWith(CODEX_FRAMING)).toBe(true)
    expect(exec?.stdin).toContain('[Attached image 2: PDF page 5]')
    const authCalls = calls.filter((call) => call.kind === 'auth').map((call) => call.args)
    expect(authCalls).toEqual([
      ['login', 'status'],
      ['login', 'status'],
    ])
    await expect(readdir(cli.tempRoot)).resolves.toEqual([])
  })

  it('maps the recorded usage-limit failure to a rate limit', async () => {
    const cli = await setup({
      run: { lines: fixtureLines('codex-run-usage-limit.jsonl'), exitCode: 1 },
    })
    const error = await rejection(createCodexCliProvider(cli.options()).analyze(REQUEST, signal()))
    expect(error.code).toBe('provider_rate_limit')
  })

  it('stops Codex when it starts a command', async () => {
    const lines = [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.started',
        item: { id: 'item_0', type: 'command_execution', command: 'ls', status: 'in_progress' },
      }),
    ]
    const cli = await setup({ run: { lines, hang: true } })
    const error = await rejection(createCodexCliProvider(cli.options()).analyze(REQUEST, signal()))
    expect(error.code).toBe('provider_invalid_output')
    expect(isRunning(analysisPid(cli))).toBe(false)
  })

  it('reports a run that wrote no answer file as incomplete', async () => {
    const cli = await setup({ run: { lines: SUCCESS } })
    const error = await rejection(createCodexCliProvider(cli.options()).analyze(REQUEST, signal()))
    expect(error.code).toBe('provider_incomplete')
  })

  it('fails when the sign-in changes during the analysis', async () => {
    const cli = await setup({
      auth: [SIGNED_IN, API_KEY],
      run: { lines: SUCCESS, answer: '{"ok":true}' },
    })
    const error = await rejection(createCodexCliProvider(cli.options()).analyze(REQUEST, signal()))
    expect(error.code).toBe('provider_account_changed')
  })

  it('signs in with codex login', async () => {
    const cli = await setup({ auth: [SIGNED_OUT, SIGNED_IN] })
    const provider = createCodexCliProvider(cli.options())
    await expect(provider.detect()).resolves.toMatchObject({ state: 'signed_out' })
    await expect(provider.connect?.(signal())).resolves.toMatchObject({
      state: 'ready',
      plan: 'ChatGPT',
    })
    expect((await cli.calls()).find((call) => call.kind === 'login')?.args).toEqual(['login'])
  })
})
