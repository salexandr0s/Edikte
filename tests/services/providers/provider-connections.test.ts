import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@shared/errors'
import { readSettings } from '../../../src/main/db/settings-store'
import {
  detectionFor,
  failureCode,
  gate,
  openHarness,
  stateOf,
  statusIn,
  tick,
  type Harness,
  type HarnessOptions,
} from './fakes'

let harness: Harness | null = null

async function detected(options?: HarnessOptions): Promise<Harness> {
  harness = openHarness(options)
  await harness.service.detect()
  return harness
}

afterEach(() => {
  harness?.close()
  harness = null
})

describe('connect', () => {
  it('refuses API-key providers and CLIs that are not installed', async () => {
    const h = await detected()

    expect(await failureCode(() => h.service.connect('openai-api'))).toBe('invalid_request')
    expect(await failureCode(() => h.service.connect('codex-cli'))).toBe('cli_not_found')
  })

  it('shows signing_in until the sign-in finishes', async () => {
    const h = await detected()

    const pending = h.service.connect('chatgpt')
    expect(stateOf(h, 'chatgpt')).toBe('signing_in')
    expect(statusIn(h.changes.at(-1) ?? [], 'chatgpt').state).toBe('signing_in')

    await tick()
    h.providers.chatgpt.finishSignIn(detectionFor('chatgpt', 'ready', { plan: 'Plus' }))

    expect(await pending).toMatchObject({ id: 'chatgpt', state: 'ready', plan: 'Plus' })
    expect(statusIn(h.changes.at(-1) ?? [], 'chatgpt').state).toBe('ready')
  })

  it('cancelConnect aborts the sign-in, which goes back to signed_out', async () => {
    const h = await detected()
    const outcome = failureCode(() => h.service.connect('chatgpt'))
    await tick()

    expect(h.service.cancelConnect('chatgpt').state).toBe('signed_out')

    expect(h.providers.chatgpt.signInSignal?.aborted).toBe(true)
    expect(await outcome).toBe('cancelled')
    expect(stateOf(h, 'chatgpt')).toBe('signed_out')
    expect(statusIn(h.changes.at(-1) ?? [], 'chatgpt').state).toBe('signed_out')
  })

  it('passes a sign-in error on and shows the state the provider reports again', async () => {
    const h = await detected({ states: { chatgpt: 'identity_only' } })
    const outcome = failureCode(() => h.service.connect('chatgpt'))
    await tick()

    h.providers.chatgpt.finishSignIn(new AppError('provider_auth', 'The sign-in was refused'))

    expect(await outcome).toBe('provider_auth')
    expect(stateOf(h, 'chatgpt')).toBe('identity_only')
  })

  it('keeps the sign-in result when a check that started earlier ends later', async () => {
    const h = await detected()
    const chatgpt = h.providers.chatgpt
    const pending = h.service.connect('chatgpt')
    await tick()

    const held = gate()
    chatgpt.detectGate = held.promise
    chatgpt.detection = detectionFor('chatgpt', 'signing_in')
    const detecting = h.service.detect()
    chatgpt.finishSignIn(detectionFor('chatgpt', 'ready'))
    expect((await pending).state).toBe('ready')

    held.release()
    await detecting
    expect(stateOf(h, 'chatgpt')).toBe('ready')
  })
})

describe('overlapping checks', () => {
  it('keep the newest result when an older check ends first', async () => {
    const h = await detected({ states: { chatgpt: 'ready' } })
    const chatgpt = h.providers.chatgpt
    const older = gate()
    chatgpt.detectGate = older.promise
    // Reads "ready", then waits.
    const detecting = h.service.detect()

    const newer = gate()
    chatgpt.detectGate = newer.promise
    // Deletes the sign-in; its own check reads "signed_out", then waits.
    const disconnecting = h.service.disconnect('chatgpt')
    await tick()

    older.release()
    await detecting
    newer.release()
    expect((await disconnecting).state).toBe('signed_out')
    expect(stateOf(h, 'chatgpt')).toBe('signed_out')
  })
})

describe('disconnect', () => {
  it('keeps a CLI signed in and only stops using it', async () => {
    const h = await detected()
    h.service.select('claude-cli')

    const status = await h.service.disconnect('claude-cli')

    expect(status).toMatchObject({
      state: 'ready',
      selected: false,
      accountLabel: 'you@example.com',
    })
    expect(h.providers['claude-cli'].disconnectCalls).toBe(1)
    expect(readSettings(h.db).selectedProvider).toBeNull()
  })

  it('deletes the ChatGPT sign-in', async () => {
    const h = await detected({ states: { chatgpt: 'ready' } })
    h.service.select('chatgpt')

    const status = await h.service.disconnect('chatgpt')

    expect(status).toMatchObject({ state: 'signed_out', selected: false, accountLabel: null })
    expect(h.providers.chatgpt.disconnectCalls).toBe(1)
    expect(readSettings(h.db).selectedProvider).toBeNull()
  })

  it('an API key makes the provider selectable until disconnect deletes it', async () => {
    const h = await detected()
    expect(await failureCode(() => h.service.select('anthropic-api'))).toBe(
      'provider_not_connected',
    )

    const saved = await h.service.setApiKey('anthropic-api', 'sk-ant-test-000000000000abcd')
    expect(saved).toMatchObject({ state: 'ready', accountLabel: '…abcd' })
    h.service.select('anthropic-api')

    const status = await h.service.disconnect('anthropic-api')
    expect(status).toMatchObject({ state: 'signed_out', selected: false, accountLabel: null })
    expect(await failureCode(() => h.service.select('anthropic-api'))).toBe(
      'provider_not_connected',
    )
  })
})

describe('CLI paths', () => {
  /** The fake Codex is found only at a path chosen in Settings. */
  function findOnlyChosenCodex(h: Harness): void {
    h.providers['codex-cli'].detectWith = () => {
      const path = h.context.cliPath('codex-cli')
      return path === null
        ? detectionFor('codex-cli', 'not_installed')
        : detectionFor('codex-cli', 'ready', { binaryPath: path, binaryPathSource: 'override' })
    }
  }

  it('chooseCliPath saves the chosen binary and checks the CLI again', async () => {
    const h = await detected()
    findOnlyChosenCodex(h)
    h.nextFile = '/opt/tools/codex'

    const status = await h.service.chooseCliPath('codex-cli')

    expect(status).toMatchObject({
      state: 'ready',
      binaryPath: '/opt/tools/codex',
      binaryPathSource: 'override',
    })
    expect(readSettings(h.db).cliPaths).toEqual({ 'codex-cli': '/opt/tools/codex' })

    h.nextFile = null
    expect(await failureCode(() => h.service.chooseCliPath('codex-cli'))).toBe('cancelled')
    expect(readSettings(h.db).cliPaths).toEqual({ 'codex-cli': '/opt/tools/codex' })
  })

  it('resetCliPath goes back to the search and deselects a CLI it no longer finds', async () => {
    const h = await detected()
    findOnlyChosenCodex(h)
    h.nextFile = '/opt/tools/codex'
    await h.service.chooseCliPath('codex-cli')
    h.service.select('codex-cli')

    const status = await h.service.resetCliPath('codex-cli')

    expect(status).toMatchObject({ state: 'not_installed', selected: false, binaryPath: null })
    expect(readSettings(h.db)).toMatchObject({ cliPaths: {}, selectedProvider: null })
  })
})
