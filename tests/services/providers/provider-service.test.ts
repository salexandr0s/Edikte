import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@shared/errors'
import { readSettings, updateSettings } from '../../../src/main/db/settings-store'
import {
  detectionFor,
  failureCode,
  openHarness,
  stateOf,
  statusIn,
  type Harness,
  type HarnessOptions,
} from './fakes'

let harness: Harness | null = null

function open(options?: HarnessOptions): Harness {
  harness = openHarness(options)
  return harness
}

afterEach(() => {
  harness?.close()
  harness = null
})

describe('provider statuses', () => {
  it('start from safe defaults, then add the selection and saved model to each detection', async () => {
    const h = open()
    expect(h.service.list().map((status) => [status.state, status.checkedAt])).toEqual([
      ['signed_out', null],
      ['not_installed', null],
      ['not_installed', null],
      ['signed_out', null],
      ['signed_out', null],
    ])
    expect(h.providers['claude-cli'].detectCalls).toBe(0)

    updateSettings(h.db, { selectedProvider: 'claude-cli', models: { 'claude-cli': 'opus' } })
    const statuses = await h.service.detect()

    expect(statusIn(statuses, 'claude-cli')).toEqual({
      ...detectionFor('claude-cli', 'ready'),
      selected: true,
      model: 'opus',
    })
    expect(statuses.filter((status) => status.selected).map((status) => status.id)).toEqual([
      'claude-cli',
    ])
    expect(h.changes).toEqual([statuses])
  })

  it('show a detection that throws as an error, without the message of an unexpected error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const h = open()
    h.providers['openai-api'].detectWith = () => {
      throw new Error('request failed for key sk-test-123456')
    }
    h.providers.chatgpt.detectWith = () => {
      throw new AppError('storage_unavailable', 'The secret file could not be read')
    }

    const statuses = await h.service.detect()

    expect(statusIn(statuses, 'openai-api')).toMatchObject({
      state: 'error',
      detail: 'Detection failed unexpectedly',
    })
    expect(statusIn(statuses, 'chatgpt')).toMatchObject({
      state: 'error',
      detail: 'The secret file could not be read',
    })
    expect(JSON.stringify(h.changes)).not.toContain('sk-test')
  })

  it('in offline mode start no CLI and still report stored sign-ins', async () => {
    const h = open({ offline: true, states: { 'openai-api': 'ready' } })

    const statuses = await h.service.detect()

    expect(h.providers['claude-cli'].detectCalls + h.providers['codex-cli'].detectCalls).toBe(0)
    expect(statuses.map((status) => status.state)).toEqual([
      'signed_out',
      'not_installed',
      'not_installed',
      'ready',
      'signed_out',
    ])
  })
})

describe('selection and models', () => {
  it('select refuses a provider that is not ready and saves a ready one', async () => {
    const h = open()
    await h.service.detect()

    expect(await failureCode(() => h.service.select('chatgpt'))).toBe('provider_not_connected')
    expect(readSettings(h.db).selectedProvider).toBeNull()

    const statuses = h.service.select('claude-cli')
    expect(statuses.filter((status) => status.selected).map((status) => status.id)).toEqual([
      'claude-cli',
    ])
    expect(readSettings(h.db).selectedProvider).toBe('claude-cli')
    expect(h.changes.at(-1)).toEqual(statuses)

    h.service.select(null)
    expect(readSettings(h.db).selectedProvider).toBeNull()
  })

  it('models refuses HTTP providers that are not ready but lists CLI models', async () => {
    const h = open({ states: { 'claude-cli': 'signed_out', 'anthropic-api': 'ready' } })
    await h.service.detect()

    expect(await failureCode(() => h.service.models('chatgpt'))).toBe('provider_not_connected')
    expect(await failureCode(() => h.service.models('openai-api'))).toBe('provider_not_connected')
    expect(await h.service.models('claude-cli')).toEqual(h.providers['claude-cli'].options)
    expect(await h.service.models('anthropic-api')).toEqual(h.providers['anthropic-api'].options)
  })

  it('setModel saves a model per provider, and null goes back to the default', async () => {
    const h = open()
    await h.service.detect()

    expect(h.service.setModel('openai-api', 'gpt-large')).toMatchObject({ model: 'gpt-large' })
    h.service.setModel('claude-cli', 'opus')
    expect(h.service.setModel('openai-api', null).model).toBeNull()

    expect(readSettings(h.db).models).toEqual({ 'claude-cli': 'opus' })
    expect(statusIn(h.changes.at(-1) ?? [], 'openai-api').model).toBeNull()
  })
})

describe('active provider', () => {
  it('needs a selected provider that is ready', async () => {
    const h = open()
    expect(await failureCode(() => h.service.active())).toBe('provider_not_selected')

    h.service.select('claude-cli')
    h.providers['claude-cli'].detection = detectionFor('claude-cli', 'signed_out')
    await h.service.detect()

    expect(stateOf(h, 'claude-cli')).toBe('signed_out')
    expect(readSettings(h.db).selectedProvider).toBe('claude-cli')
    expect(await failureCode(() => h.service.active())).toBe('provider_not_connected')
  })

  it('uses the saved model, else "default" for a CLI, else the default option of an HTTP provider', async () => {
    const h = open({ states: { 'anthropic-api': 'ready' } })
    await h.service.detect()

    h.service.select('claude-cli')
    const cli = await h.service.active()
    expect(cli.provider).toBe(h.providers['claude-cli'])
    expect(cli).toMatchObject({ model: 'default', status: { id: 'claude-cli', selected: true } })

    h.service.setModel('claude-cli', 'sonnet')
    expect((await h.service.active()).model).toBe('sonnet')

    h.service.select('anthropic-api')
    expect((await h.service.active()).model).toBe('anthropic-api-default')
  })
})
