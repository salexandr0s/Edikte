import { describe, expect, it, vi } from 'vitest'
import {
  findCliBinary,
  parseCmdShimTarget,
  type BinaryLookupDeps,
  type LookupCommandResult,
} from '../../../src/main/ai/cli/binary'

interface LookupSetup {
  platform?: NodeJS.Platform
  env?: Record<string, string>
  executables?: string[]
  files?: Record<string, string>
  /** Results by command line, e.g. "/bin/zsh -l -c whence -p claude". */
  commands?: Record<string, LookupCommandResult>
  /** Symlink targets by path. */
  links?: Record<string, string>
  /** First line by path; files without one read as binaries. */
  heads?: Record<string, string>
}

function lookup(setup: LookupSetup) {
  const executables = new Set(setup.executables)
  const runCommand = vi.fn<BinaryLookupDeps['runCommand']>((command, args) =>
    Promise.resolve(setup.commands?.[[command, ...args].join(' ')] ?? { exitCode: 1, stdout: '' }),
  )
  const deps: BinaryLookupDeps = {
    platform: setup.platform ?? 'darwin',
    env: setup.env ?? { HOME: '/Users/example', PATH: '/usr/bin:/bin' },
    homeDir: '/Users/example',
    timeoutMs: 5000,
    isExecutableFile: (path) => Promise.resolve(executables.has(path)),
    readTextFile: (path) => {
      const text = setup.files?.[path]
      return text === undefined
        ? Promise.reject(new Error(`No file ${path}`))
        : Promise.resolve(text)
    },
    realPath: (path) => Promise.resolve(setup.links?.[path] ?? path),
    readHead: (path) => {
      const head = setup.heads?.[path]
      return head === undefined
        ? Promise.resolve(Buffer.from([0xcf, 0xfa]))
        : Promise.resolve(Buffer.from(head))
    },
    runCommand,
  }
  return { deps, runCommand }
}

describe('findCliBinary on macOS and Linux', () => {
  it('uses the chosen file and does not fall back when it cannot be started', async () => {
    const { deps } = lookup({
      executables: ['/Users/example/bin/claude-2', '/opt/homebrew/bin/claude'],
    })
    await expect(findCliBinary('claude', '/Users/example/bin/claude-2', deps)).resolves.toEqual({
      cli: {
        path: '/Users/example/bin/claude-2',
        source: 'override',
        command: '/Users/example/bin/claude-2',
        prefixArgs: [],
        pathDirs: ['/Users/example/bin'],
      },
      detail: null,
    })
    await expect(findCliBinary('claude', '/Users/example/bin/missing', deps)).resolves.toEqual({
      cli: null,
      detail: 'The chosen file is not a program that can be started',
    })
  })

  it('runs an `env node` script with the node a login shell finds', async () => {
    const link = '/Users/example/.npm-global/bin/codex'
    const script = '/Users/example/.npm-global/lib/node_modules/@openai/codex/bin/codex.js'
    const node = '/Users/example/.nvm/versions/node/v22.0.0/bin/node'
    const { deps } = lookup({
      executables: [link, script, '/bin/zsh', node],
      links: { [link]: script },
      heads: { [script]: '#!/usr/bin/env node\n// Unified entry point for the Codex CLI.\n' },
      commands: { '/bin/zsh -l -c whence -p node': { exitCode: 0, stdout: `${node}\n` } },
    })
    await expect(findCliBinary('codex', link, deps)).resolves.toEqual({
      cli: {
        path: link,
        source: 'override',
        command: node,
        prefixArgs: [script],
        pathDirs: [
          '/Users/example/.nvm/versions/node/v22.0.0/bin',
          '/Users/example/.npm-global/bin',
        ],
      },
      detail: null,
    })
  })

  it('takes node from the npm prefix and keeps the options of an `env -S node` line', async () => {
    const link = '/Users/example/.local/bin/codex'
    const prefix = '/Users/example/.nvm/versions/node/v22.0.0'
    const script = `${prefix}/lib/node_modules/@openai/codex/bin/codex.js`
    const { deps, runCommand } = lookup({
      executables: [link, `${prefix}/bin/node`],
      links: { [link]: script },
      heads: { [script]: '#!/usr/bin/env -S node --no-warnings\r\n' },
    })
    await expect(findCliBinary('codex', null, deps)).resolves.toMatchObject({
      cli: {
        source: 'known_location',
        command: `${prefix}/bin/node`,
        prefixArgs: ['--no-warnings', script],
      },
    })
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('says so when a Node script has no node to run it', async () => {
    const link = '/opt/homebrew/bin/codex'
    const script = '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js'
    const { deps } = lookup({
      executables: [link],
      links: { [link]: script },
      heads: { [script]: '#!/usr/bin/env node\n' },
    })
    await expect(findCliBinary('codex', null, deps)).resolves.toEqual({
      cli: null,
      detail: 'The CLI is a Node.js script, and no node program was found to run it',
    })
  })

  it('prefers a known location over PATH', async () => {
    const { deps } = lookup({
      env: { PATH: '/custom/bin:/usr/bin' },
      executables: ['/custom/bin/claude', '/opt/homebrew/bin/claude'],
    })
    await expect(findCliBinary('claude', null, deps)).resolves.toMatchObject({
      cli: { path: '/opt/homebrew/bin/claude', source: 'known_location' },
    })
  })

  it('searches only absolute PATH entries', async () => {
    const { deps } = lookup({
      env: { PATH: 'node_modules/.bin:/custom/bin' },
      executables: ['node_modules/.bin/codex', '/custom/bin/codex'],
    })
    await expect(findCliBinary('codex', null, deps)).resolves.toMatchObject({
      cli: { path: '/custom/bin/codex', source: 'path' },
    })
  })

  it('asks a login shell last, with a minimal environment', async () => {
    const { deps, runCommand } = lookup({
      env: {
        HOME: '/Users/example',
        USER: 'example',
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/zsh',
        OPENAI_API_KEY: 'test-value',
      },
      executables: ['/bin/zsh', '/Users/example/.volta/bin/codex'],
      commands: {
        '/bin/zsh -l -c whence -p codex': {
          exitCode: 0,
          stdout: 'Welcome back!\n/Users/example/.volta/bin/codex\n',
        },
      },
    })
    await expect(findCliBinary('codex', null, deps)).resolves.toMatchObject({
      cli: { path: '/Users/example/.volta/bin/codex', source: 'login_shell' },
    })
    expect(runCommand).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-l', '-c', 'whence -p codex'],
      { HOME: '/Users/example', USER: 'example', PATH: '/usr/bin:/bin' },
      5000,
    )
  })

  it('takes only an absolute path to a program from a login shell', async () => {
    const { deps } = lookup({
      executables: ['/bin/zsh', '/bin/bash'],
      commands: {
        '/bin/zsh -l -c whence -p claude': {
          exitCode: 0,
          stdout: 'claude: aliased to claude --x\n',
        },
        '/bin/bash -l -c type -P claude': { exitCode: 0, stdout: '/Users/example/bin/claude\n' },
      },
    })
    await expect(findCliBinary('claude', null, deps)).resolves.toEqual({ cli: null, detail: null })
  })
})

const NPM = 'C:\\Users\\example\\AppData\\Roaming\\npm'

const SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
].join('\r\n')

const OLD_SHIM = [
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
  ') ELSE (',
  '  @SETLOCAL',
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
  '  node  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
  ')',
].join('\r\n')

describe('parseCmdShimTarget', () => {
  it.each([
    {
      name: 'the current npm shim',
      text: SHIM,
      target: 'node_modules\\@anthropic-ai\\claude-code\\cli.js',
    },
    {
      name: 'the older npm shim',
      text: OLD_SHIM,
      target: 'node_modules\\@openai\\codex\\bin\\codex.js',
    },
    { name: 'a batch file that is no shim', text: '@echo off\r\necho %*', target: null },
  ])('reads $name', ({ text, target }) => {
    expect(parseCmdShimTarget(text)).toBe(target)
  })
})

describe('findCliBinary on Windows', () => {
  const env = {
    USERPROFILE: 'C:\\Users\\example',
    SystemRoot: 'C:\\Windows',
    Path: `${NPM};C:\\Windows\\System32`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
  }

  it('prefers the native installer location', async () => {
    const native = 'C:\\Users\\example\\.local\\bin\\claude.exe'
    const { deps, runCommand } = lookup({ platform: 'win32', env, executables: [native] })
    await expect(findCliBinary('claude', null, deps)).resolves.toMatchObject({
      cli: { path: native, source: 'known_location', command: native },
    })
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('runs the script behind an npm .cmd shim with node.exe', async () => {
    const entry = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`
    const node = 'C:\\Program Files\\nodejs\\node.exe'
    const { deps, runCommand } = lookup({
      platform: 'win32',
      env,
      executables: [entry, node],
      files: { [`${NPM}\\claude.cmd`]: SHIM },
      commands: {
        'C:\\Windows\\System32\\where.exe claude': {
          exitCode: 0,
          stdout: `${NPM}\\claude\r\n${NPM}\\claude.cmd\r\n`,
        },
        'C:\\Windows\\System32\\where.exe node': { exitCode: 0, stdout: `${node}\r\n` },
      },
    })
    await expect(findCliBinary('claude', null, deps)).resolves.toEqual({
      cli: {
        path: `${NPM}\\claude.cmd`,
        source: 'path',
        command: node,
        prefixArgs: [entry],
        pathDirs: ['C:\\Program Files\\nodejs', NPM],
      },
      detail: null,
    })
    expect(runCommand).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\where.exe',
      ['claude'],
      {
        SystemRoot: 'C:\\Windows',
        PATH: `${NPM};C:\\Windows\\System32`,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      },
      5000,
    )
  })
})
