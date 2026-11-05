import { describe, expect, it, vi } from 'vitest'
import {
  CODEX_FRAMING,
  CODEX_REQUIRED_FLAGS,
  CodexEventParser,
  buildCodexExecArgs,
  buildCodexPrompt,
  codexErrorCode,
  codexFeaturesToDisable,
  codexShellToolOff,
  isCodexModel,
  parseCodexAnswer,
  parseCodexFeatures,
  parseCodexLoginStatus,
} from '../../../src/main/ai/cli/codex-protocol'
import type { AnalysisProgressHandler } from '../../../src/main/ai/provider'
import { fixtureLines, readFixture, thrown } from './fake-cli-harness'

const PATHS = {
  workDir: '/tmp/edikte-cli-1',
  schemaPath: '/tmp/edikte-cli-1/output-schema.json',
  answerPath: '/tmp/edikte-cli-1/answer.json',
  imageFiles: ['image-1-page-2.jpg', 'image-2-page-5.jpg'],
}

describe('buildCodexExecArgs', () => {
  it('puts the images first, so -i cannot take the stdin marker as a file', () => {
    expect(buildCodexExecArgs(PATHS, 'gpt-5.5', ['shell_tool', 'view_image'])).toEqual([
      'exec',
      '--json',
      '-i',
      'image-1-page-2.jpg',
      '-i',
      'image-2-page-5.jpg',
      '--output-schema',
      '/tmp/edikte-cli-1/output-schema.json',
      '-o',
      '/tmp/edikte-cli-1/answer.json',
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--disable',
      'shell_tool',
      '--disable',
      'view_image',
      '-C',
      '/tmp/edikte-cli-1',
      '-m',
      'gpt-5.5',
      '-',
    ])
    expect(buildCodexExecArgs({ ...PATHS, imageFiles: [] }, 'default', [])).not.toContain('-m')
  })

  it('uses no flag that the update check leaves out', () => {
    const args = buildCodexExecArgs(PATHS, 'gpt-5.5', ['shell_tool'])
    const flags = args.filter((arg) => /^-./.test(arg))
    expect(flags.filter((flag) => !CODEX_REQUIRED_FLAGS.includes(flag))).toEqual([])
  })
})

describe('codexFeaturesToDisable', () => {
  it.each(['codex-features-list.txt', 'codex-features-list-0.154.0.txt'])(
    'switches off the tool features of %s, whatever state the list shows',
    (fixture) => {
      const disabled = codexFeaturesToDisable(parseCodexFeatures(readFixture(fixture)))
      // memories, multi_agent_v2 and request_permissions_tool are off in the
      // list, but the list includes the user's config.toml and the run does not.
      expect(disabled).toEqual(
        expect.arrayContaining([
          'shell_tool',
          'unified_exec',
          'apps',
          'browser_use',
          'computer_use',
          'hooks',
          'plugins',
          'skill_search',
          'memories',
          'multi_agent_v2',
          'request_permissions_tool',
        ]),
      )
      // Plumbing stays on, and removed features are left out.
      for (const name of ['fast_mode', 'guardian_approval', 'js_repl', 'tool_search']) {
        expect(disabled).not.toContain(name)
      }
    },
  )

  it('leaves skip_ features alone', () => {
    const list = readFixture('codex-features-list-0.154.0.txt')
    const disabled = codexFeaturesToDisable(parseCodexFeatures(list))
    expect(list).toMatch(/^skip_host_skill_discovery /m)
    expect(disabled).not.toContain('skip_host_skill_discovery')
    expect(disabled).toContain('worktrees')
  })

  it('needs both shell features, and switches them off even when the user did', () => {
    const list = readFixture('codex-features-list.txt')
    const without = list.replace(/^unified_exec .*$/m, '')
    expect(codexFeaturesToDisable(parseCodexFeatures(without))).toBeNull()
    const removed = list.replace(/^shell_tool .*$/m, 'shell_tool  removed  false')
    expect(codexFeaturesToDisable(parseCodexFeatures(removed))).toBeNull()
    const userOff = list.replace(/^(shell_tool +stable +)true$/m, '$1false')
    expect(codexFeaturesToDisable(parseCodexFeatures(userOff))).toContain('shell_tool')
  })
})

describe('codexShellToolOff', () => {
  it('reads shell_tool from the list printed with the --disable flags', () => {
    const list = readFixture('codex-features-list-0.154.0.txt')
    expect(codexShellToolOff(parseCodexFeatures(list))).toBe(false)
    const off = list.replace(/^(shell_tool +stable +)true$/m, '$1false')
    expect(codexShellToolOff(parseCodexFeatures(off))).toBe(true)
    expect(codexShellToolOff([])).toBe(false)
  })
})

describe('buildCodexPrompt', () => {
  it('starts with the framing and replaces each image with a marker and a file', () => {
    const { prompt, images } = buildCodexPrompt('Extract the facts.', [
      { type: 'text', text: 'Seite 1' },
      { type: 'image', mediaType: 'image/jpeg', data: Buffer.from('jpeg'), page: 3 },
    ])
    expect(prompt).toBe(
      `${CODEX_FRAMING}\n\nExtract the facts.\n\nSeite 1\n\n[Attached image 1: PDF page 3]\n`,
    )
    expect(images).toEqual([{ fileName: 'image-1-page-3.jpg', data: Buffer.from('jpeg') }])
  })
})

describe('parseCodexLoginStatus', () => {
  it.each([
    { output: 'Logged in using ChatGPT', exitCode: 0, loggedIn: true, plan: 'ChatGPT' },
    {
      output: 'Logged in using an API key - sk-proj-***ABCD',
      exitCode: 0,
      loggedIn: true,
      plan: 'API key',
    },
    { output: 'Not logged in', exitCode: 1, loggedIn: false, plan: null },
  ])('reads "$output"', ({ output, exitCode, loggedIn, plan }) => {
    expect(parseCodexLoginStatus(exitCode, '', `${output}\n`)).toMatchObject({
      loggedIn,
      plan,
      accountLabel: null,
    })
  })

  it('tells sign-in methods apart', () => {
    const chatgpt = parseCodexLoginStatus(0, '', 'Logged in using ChatGPT\n').fingerprint
    expect(parseCodexLoginStatus(0, 'Logged in using ChatGPT\n', '').fingerprint).toBe(chatgpt)
    const apiKey = parseCodexLoginStatus(0, '', 'Logged in using an API key - sk-***\n')
    expect(apiKey.fingerprint).not.toBe(chatgpt)
  })
})

describe('CodexEventParser', () => {
  it('reads a successful run', () => {
    const progress = vi.fn<AnalysisProgressHandler>()
    const parser = new CodexEventParser(progress)
    for (const line of fixtureLines('codex-run-success-synthetic.jsonl')) parser.push(line)
    expect(parser.finish(0, '')).toMatchObject({ inputTokens: 3150, outputTokens: 42 })
    expect(progress).toHaveBeenNthCalledWith(1, { phase: 'waiting' })
    expect(progress).toHaveBeenLastCalledWith({ phase: 'streaming' })
  })

  it('keeps going past warning items and stops at the recorded usage limit', () => {
    const parser = new CodexEventParser()
    const lines = fixtureLines('codex-run-usage-limit.jsonl')
    const failed = thrown(() => {
      for (const line of lines) parser.push(line)
    })
    expect(failed.code).toBe('provider_rate_limit')
    expect(failed.message).toContain("You've hit your usage limit")
  })

  it.each(['command_execution', 'file_change', 'mcp_tool_call', 'web_search'])(
    'stops when Codex starts a %s step',
    (type) => {
      const parser = new CodexEventParser()
      parser.push(JSON.stringify({ type: 'turn.started' }))
      const started = JSON.stringify({ type: 'item.started', item: { id: 'item_1', type } })
      expect(thrown(() => parser.push(started)).code).toBe('provider_invalid_output')
    },
  )

  it('maps the last error when Codex exits with an error, and needs a finished turn', () => {
    const failed = new CodexEventParser()
    failed.push(JSON.stringify({ type: 'turn.started' }))
    failed.push(JSON.stringify({ type: 'error', message: 'unexpected status 401 Unauthorized' }))
    expect(thrown(() => failed.finish(1, '')).code).toBe('provider_auth')
    const unfinished = new CodexEventParser()
    unfinished.push(JSON.stringify({ type: 'turn.started' }))
    expect(thrown(() => unfinished.finish(0, '')).code).toBe('provider_incomplete')
  })
})

describe('codexErrorCode', () => {
  it.each([
    { message: "You've hit your usage limit. Try again later.", code: 'provider_rate_limit' },
    {
      message: 'You exceeded your current quota, please check your plan and billing details.',
      code: 'provider_billing',
    },
    {
      message: 'Your access token could not be refreshed. Please log out and sign in again.',
      code: 'provider_auth',
    },
    { message: 'Codex ran out of room in the model context window.', code: 'document_too_large' },
    { message: 'Input exceeds the context length of the model', code: 'document_too_large' },
    { message: 'The response hit the max output tokens limit', code: 'provider_incomplete' },
    { message: 'stream disconnected before completion', code: 'cli_failed' },
  ])('maps "$message" to $code', ({ message, code }) => {
    expect(codexErrorCode(message)).toBe(code)
  })
})

describe('parseCodexAnswer', () => {
  it('reads the JSON answer, also inside a code fence', () => {
    expect(parseCodexAnswer('{"ok":true}\n')).toEqual({ ok: true })
    expect(parseCodexAnswer('```json\n{"ok":true}\n```\n')).toEqual({ ok: true })
  })

  it('rejects an empty answer and one that is not JSON', () => {
    expect(thrown(() => parseCodexAnswer('  \n')).code).toBe('provider_incomplete')
    expect(thrown(() => parseCodexAnswer('Here is the JSON.')).code).toBe('provider_invalid_output')
  })
})

describe('isCodexModel', () => {
  it('accepts model IDs and rejects text that could read as a flag', () => {
    const valid = ['default', 'gpt-5.5', 'o4-mini', 'gpt-5.1-codex-max']
    expect(valid.filter((id) => !isCodexModel(id))).toEqual([])
    const invalid = ['-c', '--config=x', '', 'gpt 5', 'x'.repeat(101)]
    expect(invalid.filter((id) => isCodexModel(id))).toEqual([])
  })
})
