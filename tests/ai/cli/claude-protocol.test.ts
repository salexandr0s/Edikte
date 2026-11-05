import { describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_REQUIRED_FLAGS,
  ClaudeStreamParser,
  buildClaudeAnalysisArgs,
  encodeClaudeInput,
  parseClaudeAuthStatus,
} from '../../../src/main/ai/cli/claude-protocol'
import type { AnalysisProgressHandler } from '../../../src/main/ai/provider'
import { fixtureLines, thrown } from './fake-cli-harness'

const json = (value: Record<string, unknown>): string => JSON.stringify(value)
const INIT_FIELDS = {
  type: 'system',
  subtype: 'init',
  tools: ['StructuredOutput'],
  mcp_servers: [],
  plugins: [],
  skills: [],
  model: 'claude-sonnet-4-5',
}
const INIT = json(INIT_FIELDS)
const result = (fields: Record<string, unknown> = {}): string =>
  json({
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'tool_use',
    api_error_status: null,
    structured_output: { ok: true },
    usage: { input_tokens: 10, output_tokens: 5 },
    total_cost_usd: 0.001,
    ...fields,
  })
const assistant = (fields: Record<string, unknown> = {}): string =>
  json({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Done' }] },
    parent_tool_use_id: null,
    ...fields,
  })

function parse(lines: string[], exitCode: number | null = 0, stderr = '') {
  const parser = new ClaudeStreamParser()
  for (const line of lines) parser.push(line)
  return parser.finish(exitCode, stderr)
}

describe('buildClaudeAnalysisArgs', () => {
  const request = { model: 'default', system: 'Answer as JSON.', jsonSchema: { type: 'object' } }

  it('builds the planned argument list, without --model for the default model', () => {
    expect(buildClaudeAnalysisArgs(request)).toEqual([
      '--safe-mode',
      '--setting-sources',
      '',
      '--settings',
      '{"disableAllHooks":true,"enabledPlugins":{}}',
      '--disable-slash-commands',
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--no-chrome',
      '--print',
      '--no-session-persistence',
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
      '--system-prompt',
      'Answer as JSON.',
      '--json-schema',
      '{"type":"object"}',
    ])
    expect(buildClaudeAnalysisArgs({ ...request, model: 'opus' }).slice(-2)).toEqual([
      '--model',
      'opus',
    ])
  })

  it('uses no flag that the update check leaves out', () => {
    const args = buildClaudeAnalysisArgs({ ...request, model: 'haiku' })
    const flags = args.filter((arg) => arg.startsWith('--'))
    expect(flags.filter((flag) => !CLAUDE_REQUIRED_FLAGS.includes(flag))).toEqual([])
  })
})

describe('encodeClaudeInput', () => {
  it('sends text and page images as one stream-json user message', () => {
    const encoded = encodeClaudeInput([
      { type: 'text', text: 'Seite 1' },
      { type: 'text', text: '  ' },
      { type: 'image', mediaType: 'image/jpeg', data: Buffer.from('jpeg'), page: 4 },
    ]).toString('utf8')
    expect(encoded.endsWith('}\n')).toBe(true)
    expect(encoded.trimEnd()).not.toContain('\n')
    const message: unknown = JSON.parse(encoded)
    expect(message).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Seite 1' },
          { type: 'text', text: '[Image: PDF page 4]' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: Buffer.from('jpeg').toString('base64'),
            },
          },
        ],
      },
      parent_tool_use_id: null,
    })
  })

  it('refuses a request without content', () => {
    expect(thrown(() => encodeClaudeInput([{ type: 'text', text: '' }])).code).toBe(
      'invalid_request',
    )
  })
})

describe('parseClaudeAuthStatus', () => {
  const subscription = {
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    email: 'person@example.com',
    orgId: '00000000-0000-4000-8000-000000000001',
    orgName: 'Example',
    subscriptionType: 'max',
  }

  it('reads a Claude subscription', () => {
    expect(parseClaudeAuthStatus(JSON.stringify(subscription, null, 2))).toMatchObject({
      loggedIn: true,
      accountLabel: 'person@example.com',
      plan: 'Max',
      subscription: true,
    })
  })

  it('reads an API account and a signed-out CLI', () => {
    const api = { loggedIn: true, authMethod: 'console', email: null, orgName: 'Example GmbH' }
    expect(parseClaudeAuthStatus(JSON.stringify(api))).toMatchObject({
      accountLabel: 'Example GmbH',
      plan: 'API',
      subscription: false,
    })
    expect(parseClaudeAuthStatus('{"loggedIn": false}')).toMatchObject({ loggedIn: false })
    expect(parseClaudeAuthStatus('Not logged in')).toBeNull()
  })

  it('gives another account another fingerprint', () => {
    const fingerprint = (fields: object) =>
      parseClaudeAuthStatus(JSON.stringify({ ...subscription, ...fields }))?.fingerprint
    expect(fingerprint({})).toBe(fingerprint({ orgName: 'Renamed' }))
    expect(fingerprint({})).not.toBe(fingerprint({ email: 'other@example.com' }))
    expect(fingerprint({})).not.toBe(fingerprint({ subscriptionType: 'pro' }))
  })
})

describe('ClaudeStreamParser', () => {
  it('reads the recorded run of claude 2.1.226', () => {
    const progress = vi.fn<AnalysisProgressHandler>()
    const parser = new ClaudeStreamParser(progress)
    for (const line of fixtureLines('claude-run-success.jsonl')) parser.push(line)
    expect(parser.finish(0, '')).toMatchObject({
      structuredOutput: { ok: true },
      inputTokens: 905,
      outputTokens: 103,
      costUsd: 0.0014199999999999998,
      model: 'claude-haiku-4-5-20251001',
    })
    expect(progress).toHaveBeenNthCalledWith(1, { phase: 'waiting' })
    expect(progress).toHaveBeenLastCalledWith({ phase: 'streaming', outputTokens: 123 })
  })

  it.each([
    { name: 'a tool other than StructuredOutput', fields: { tools: ['StructuredOutput', 'Bash'] } },
    { name: 'an MCP server', fields: { mcp_servers: [{ name: 'files', status: 'connected' }] } },
    { name: 'a plugin', fields: { plugins: [{ name: 'helper', path: '/plugins/helper' }] } },
    { name: 'a skill', fields: { skills: ['pdf'] } },
    { name: 'no tool list', fields: { tools: undefined } },
  ])('stops at a system/init line with $name', ({ fields }) => {
    const parser = new ClaudeStreamParser()
    expect(thrown(() => parser.push(json({ ...INIT_FIELDS, ...fields }))).code).toBe(
      'provider_invalid_output',
    )
  })

  it('stops when the first line is not system/init', () => {
    expect(thrown(() => new ClaudeStreamParser().push(assistant())).code).toBe(
      'provider_invalid_output',
    )
  })

  it.each([
    {
      name: 'authentication_failed',
      line: assistant({ error: 'authentication_failed' }),
      code: 'provider_auth',
    },
    {
      name: 'billing_error',
      line: assistant({ error: 'billing_error' }),
      code: 'provider_billing',
    },
    { name: 'rate_limit', line: assistant({ error: 'rate_limit' }), code: 'provider_rate_limit' },
    {
      name: 'max_output_tokens',
      line: assistant({ error: 'max_output_tokens' }),
      code: 'provider_incomplete',
    },
    {
      name: 'server_error',
      line: assistant({ error: 'server_error' }),
      code: 'provider_unavailable',
    },
    {
      name: 'error_max_turns',
      line: result({ subtype: 'error_max_turns' }),
      code: 'provider_incomplete',
    },
    {
      name: 'error_max_structured_output_retries',
      line: result({ subtype: 'error_max_structured_output_retries' }),
      code: 'provider_incomplete',
    },
    {
      name: 'error_max_budget_usd',
      line: result({ subtype: 'error_max_budget_usd' }),
      code: 'provider_billing',
    },
    {
      name: 'error_during_execution',
      line: result({ subtype: 'error_during_execution' }),
      code: 'cli_failed',
    },
    {
      name: 'HTTP 401',
      line: result({ is_error: true, api_error_status: 401 }),
      code: 'provider_auth',
    },
    {
      name: 'HTTP 429',
      line: result({ is_error: true, api_error_status: 429 }),
      code: 'provider_rate_limit',
    },
    {
      name: 'HTTP 529',
      line: result({ is_error: true, api_error_status: 529 }),
      code: 'provider_unavailable',
    },
    {
      name: 'stop reason refusal',
      line: result({ stop_reason: 'refusal' }),
      code: 'provider_refused',
    },
    {
      name: 'stop reason max_tokens',
      line: result({ stop_reason: 'max_tokens' }),
      code: 'provider_incomplete',
    },
    {
      name: 'stop reason model_context_window_exceeded',
      line: result({ stop_reason: 'model_context_window_exceeded' }),
      code: 'document_too_large',
    },
    {
      name: 'a prompt that is too long',
      line: result({ is_error: true, api_error_status: 400, result: 'Prompt is too long' }),
      code: 'document_too_large',
    },
    {
      name: 'a Bash tool call',
      line: assistant({ message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } }),
      code: 'provider_invalid_output',
    },
    {
      name: 'a subagent message',
      line: assistant({ parent_tool_use_id: 'toolu_example' }),
      code: 'provider_invalid_output',
    },
    {
      name: 'a result without structured_output',
      line: result({ structured_output: null }),
      code: 'provider_invalid_output',
    },
  ])('maps $name to $code', ({ line, code }) => {
    const parser = new ClaudeStreamParser()
    parser.push(INIT)
    expect(thrown(() => parser.push(line)).code).toBe(code)
  })

  it('needs a clean exit and exactly one result line', () => {
    const failed = thrown(() => parse([INIT], 1, 'Starting\nError: the session did not start\n'))
    expect(failed.code).toBe('cli_failed')
    expect(failed.message).toContain('the session did not start')
    expect(thrown(() => parse([INIT])).code).toBe('provider_incomplete')
    expect(thrown(() => parse([INIT, result(), assistant()])).code).toBe('provider_invalid_output')
  })
})
