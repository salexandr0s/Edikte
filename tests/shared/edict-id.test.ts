import { describe, expect, it } from 'vitest'
import {
  AUCTION_EDICT_ID_PATTERN,
  EDICT_ID_PATTERN,
  INSOLVENCY_EDICT_ID_PATTERN,
  insolvencyEdictId,
  insolvencyRecordNumber,
  isInsolvencyRecordNumber,
} from '@shared/edict-id'

const AUCTION_ID = '0123456789abcdef0123456789abcdef'

describe('edict IDs', () => {
  it('accepts both kinds and tells them apart', () => {
    expect(EDICT_ID_PATTERN.test(AUCTION_ID)).toBe(true)
    expect(EDICT_ID_PATTERN.test('mv-990001')).toBe(true)
    expect(AUCTION_EDICT_ID_PATTERN.test('mv-990001')).toBe(false)
    expect(INSOLVENCY_EDICT_ID_PATTERN.test(AUCTION_ID)).toBe(false)
  })

  // An ID names the folder that holds a record's documents.
  it.each([
    '',
    'mv-',
    'mv-0',
    'mv-0990001',
    'mv-990001/..',
    'mv-990001/../x',
    '../mv-990001',
    'mv-99 0001',
    'MV-990001',
    'mv-990001\n',
    `mv-${'9'.repeat(13)}`,
    AUCTION_ID.toUpperCase(),
    AUCTION_ID.slice(1),
    `${AUCTION_ID}0`,
    `${AUCTION_ID}\n`,
  ])('refuses %j', (id) => {
    expect(EDICT_ID_PATTERN.test(id)).toBe(false)
  })

  it('builds and reads the ID of a JustizOnline record', () => {
    expect(insolvencyEdictId(990001)).toBe('mv-990001')
    expect(insolvencyRecordNumber('mv-990001')).toBe(990001)
    expect(insolvencyRecordNumber(AUCTION_ID)).toBeNull()
    expect(isInsolvencyRecordNumber(990001)).toBe(true)
    for (const bad of [0, -1, 1.5, Number.NaN, 1e21]) {
      expect(isInsolvencyRecordNumber(bad)).toBe(false)
      expect(() => insolvencyEdictId(bad)).toThrow(RangeError)
    }
  })
})
