import { describe, expect, it } from 'vitest'
import { buildCliEnvironment } from '../../../src/main/ai/cli/environment'
import { LEAKY_ENV } from './fake-cli-harness'

const FIXED = {
  NO_COLOR: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
}

describe('buildCliEnvironment', () => {
  it('passes only HOME, USER, PATH and TMPDIR on macOS and Linux', () => {
    const env = buildCliEnvironment({
      source: {
        ...LEAKY_ENV,
        HOME: '/Users/example',
        USER: 'example',
        SHELL: '/bin/zsh',
        LANG: 'de_AT.UTF-8',
        PATH: '/opt/homebrew/bin:node_modules/.bin:/usr/bin:/opt/homebrew/bin',
      },
      platform: 'darwin',
      homeDir: '/Users/example',
      tempDir: '/tmp/edikte-cli-1',
      binaryDir: '/Users/example/.local/bin',
    })
    expect(env).toEqual({
      ...FIXED,
      HOME: '/Users/example',
      USER: 'example',
      PATH: '/Users/example/.local/bin:/opt/homebrew/bin:/usr/bin',
      TMPDIR: '/tmp/edikte-cli-1',
    })
  })

  it('reads Path in any case on Windows and adds the profile folders', () => {
    const temp = 'C:\\Users\\example\\AppData\\Local\\Temp\\edikte-cli-1'
    const env = buildCliEnvironment({
      source: {
        ...LEAKY_ENV,
        Path: 'C:\\Users\\example\\AppData\\Roaming\\npm;.\\bin;C:\\WINDOWS\\system32',
        USERPROFILE: 'C:\\Users\\example',
        APPDATA: 'C:\\Users\\example\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local',
        SystemRoot: 'C:\\WINDOWS',
        USERNAME: 'example',
        ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe',
      },
      platform: 'win32',
      homeDir: 'C:\\Users\\example',
      tempDir: temp,
      binaryDir: 'C:\\Program Files\\nodejs',
    })
    expect(env).toEqual({
      ...FIXED,
      PATH: 'C:\\Program Files\\nodejs;C:\\Users\\example\\AppData\\Roaming\\npm;C:\\WINDOWS\\system32',
      TMPDIR: temp,
      TEMP: temp,
      USERPROFILE: 'C:\\Users\\example',
      APPDATA: 'C:\\Users\\example\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local',
      SystemRoot: 'C:\\WINDOWS',
    })
  })
})
