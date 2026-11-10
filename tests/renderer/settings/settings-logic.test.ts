import { describe, expect, it } from 'vitest'
import type { ModelOption, ProviderStatus } from '@shared/providers'
import {
  applyProviderUpdate,
  modelChoice,
} from '../../../src/renderer/src/features/settings/providers/provider-logic'
import {
  parseRetentionDays,
  toggleBundesland,
  toggleSyncSource,
} from '../../../src/renderer/src/features/settings/settings-logic'

function status(id: ProviderStatus['id'], changes: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    id,
    state: 'signed_out',
    version: null,
    binaryPath: null,
    binaryPathSource: null,
    accountLabel: null,
    plan: null,
    detail: null,
    selected: false,
    model: null,
    checkedAt: null,
    ...changes,
  }
}

function option(id: string, isDefault = false): ModelOption {
  return { id, label: id, supportsImages: true, isDefault }
}

describe('parseRetentionDays', () => {
  it('accepts whole days from 1 to 3650', () => {
    expect(parseRetentionDays('1')).toBe(1)
    expect(parseRetentionDays(' 3650 ')).toBe(3650)
  })

  it('rejects what the settings schema would refuse', () => {
    for (const input of ['', '0', '3651', '1.5', '-3', '12abc', '1e3']) {
      expect(parseRetentionDays(input), input).toBeNull()
    }
  })
})

describe('toggleBundesland', () => {
  it('keeps the site order and drops cleared entries', () => {
    expect(toggleBundesland(['bgld'], 'wien', true)).toEqual(['wien', 'bgld'])
    expect(toggleBundesland(['wien', 'noe'], 'wien', false)).toEqual(['noe'])
  })
})

describe('toggleSyncSource', () => {
  it('keeps a source enabled and restores source order when adding one', () => {
    expect(toggleSyncSource(['insolvency_sale'], 'insolvency_sale', false)).toBeNull()
    expect(toggleSyncSource(['insolvency_sale'], 'court_auction', true)).toEqual([
      'court_auction',
      'insolvency_sale',
    ])
    expect(toggleSyncSource(['court_auction', 'insolvency_sale'], 'court_auction', false)).toEqual([
      'insolvency_sale',
    ])
  })
})

describe('modelChoice', () => {
  it('shows the default option while no model is saved', () => {
    expect(modelChoice([option('a'), option('b', true)], null)).toEqual({ value: 'b', extra: null })
  })

  it('keeps a saved model that the provider does not list', () => {
    expect(modelChoice([option('a', true)], 'typed-id')).toEqual({
      value: 'typed-id',
      extra: 'typed-id',
    })
  })
})

describe('applyProviderUpdate', () => {
  it('replaces one status and keeps the provider order', () => {
    const list = [status('chatgpt'), status('claude-cli'), status('openai-api')]
    const next = applyProviderUpdate(list, status('claude-cli', { state: 'ready' }))
    expect(next?.map(({ id, state }) => [id, state])).toEqual([
      ['chatgpt', 'signed_out'],
      ['claude-cli', 'ready'],
      ['openai-api', 'signed_out'],
    ])
  })

  it('sorts a full list into provider order', () => {
    const next = applyProviderUpdate(null, [status('anthropic-api'), status('chatgpt')])
    expect(next?.map(({ id }) => id)).toEqual(['chatgpt', 'anthropic-api'])
  })
})
