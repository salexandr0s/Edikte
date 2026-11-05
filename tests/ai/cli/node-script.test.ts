import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createCodexCliProvider } from '../../../src/main/ai/cli/codex-provider'
import { FAKE_CLI_SCRIPT, createFakeCli, readFixture, type FakeCli } from './fake-cli-harness'

let fake: FakeCli | null = null
afterEach(async () => {
  await fake?.cleanup()
  fake = null
})

describe.skipIf(process.platform === 'win32')('a CLI installed as an npm script', () => {
  it('runs `node <script>` with a node from the npm prefix when PATH has none', async () => {
    fake = await createFakeCli({
      version: 'codex-cli 0.154.0',
      help: readFixture('codex-exec-help.txt'),
      features: readFixture('codex-features-list-0.154.0.txt'),
      auth: [{ stderr: 'Logged in using ChatGPT\n' }],
    })
    // npm's layout: <prefix>/bin/node and <prefix>/lib/node_modules/<package>, with the
    // command linked from a folder that has no node in it, as in ~/.local/bin.
    const prefix = join(fake.home, 'npm-prefix')
    const script = join(prefix, 'lib', 'node_modules', 'fake-codex', 'bin', 'codex.mjs')
    const link = join(fake.home, '.local', 'bin', 'codex')
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await mkdir(dirname(script), { recursive: true })
    await mkdir(dirname(link), { recursive: true })
    await symlink(process.execPath, join(prefix, 'bin', 'node'))
    const entry = JSON.stringify(pathToFileURL(FAKE_CLI_SCRIPT).href)
    await writeFile(script, `#!/usr/bin/env node\nawait import(${entry})\n`, { mode: 0o755 })
    await symlink(script, link)

    const provider = createCodexCliProvider(fake.options({ getOverridePath: () => link }))
    await expect(provider.detect()).resolves.toMatchObject({
      state: 'ready',
      version: '0.154.0',
      binaryPath: link,
    })
    const realScript = await realpath(script)
    const nodeDir = join(await realpath(prefix), 'bin')
    expect(fake.spawns.length).toBeGreaterThan(0)
    for (const { args, options } of fake.spawns) {
      expect(args[0]).toBe(realScript)
      expect(options.env?.PATH).toBe(`${nodeDir}:${dirname(link)}:/usr/bin:/bin`)
    }
  })
})
