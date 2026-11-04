import { describe, expect, it } from 'vitest'
import { findMissingFlags, parseCliVersion, safeDetail } from '../../../src/main/ai/cli/cli-output'
import { CLAUDE_REQUIRED_FLAGS } from '../../../src/main/ai/cli/claude-protocol'
import { CODEX_REQUIRED_FLAGS } from '../../../src/main/ai/cli/codex-protocol'
import { readFixture } from './fake-cli-harness'

describe('parseCliVersion', () => {
  it.each([
    { output: '2.1.226 (Claude Code)\n', version: '2.1.226' },
    { output: 'codex-cli 0.154.0\n', version: '0.154.0' },
    { output: 'v1.4.0-beta.2', version: '1.4.0-beta.2' },
    { output: 'zsh: command not found: claude', version: null },
  ])('reads $version from $output', ({ output, version }) => {
    expect(parseCliVersion(output)).toBe(version)
  })
})

describe('findMissingFlags', () => {
  it('finds every flag the app uses in the help of claude 2.1.226 and codex 0.154.0', () => {
    expect(findMissingFlags(readFixture('claude-help.txt'), CLAUDE_REQUIRED_FLAGS)).toEqual([])
    expect(findMissingFlags(readFixture('codex-exec-help.txt'), CODEX_REQUIRED_FLAGS)).toEqual([])
  })

  it('counts flags in the option column, not flags a description mentions', () => {
    const help = [
      'Options:',
      '  -p, --print                 Print the response and exit (useful with --output-format)',
      '  --model <model>             Model for the session',
      '      --ephemeral',
      '          Run without persisting session files to disk',
    ].join('\n')
    const required = ['-p', '--print', '--model', '--ephemeral', '--output-format']
    expect(findMissingFlags(help, required)).toEqual(['--output-format'])
  })
})

describe('safeDetail', () => {
  it('removes colour codes and control characters and shortens long text', () => {
    expect(safeDetail('\u001b[31mError:\u001b[0m token\texpired\u0007')).toBe(
      'Error: token expired',
    )
    expect(safeDetail('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
