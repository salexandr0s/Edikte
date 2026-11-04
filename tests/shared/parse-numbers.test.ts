import { describe, expect, it } from 'vitest'
import { findSqmMentions, parseEur, parseGermanNumber, parseSqm } from '@shared/parse-numbers'

describe('parseGermanNumber', () => {
  it.each([
    ['245.000,00', 245_000],
    ['245.000', 245_000],
    ['245.000,-', 245_000],
    ['65,76', 65.76],
    ['3.353', 3353],
    ['1.234,56', 1234.56],
    ['1.234.567', 1_234_567],
    ['58.4', 58.4],
    ['0,5', 0.5],
    ['0.500', 0.5],
    ['1,234,567.89', 1_234_567.89],
  ])('reads %s as %d', (raw, expected) => {
    expect(parseGermanNumber(raw)).toBe(expected)
  })

  it.each(['abc', '', '12.34.5'])('rejects %j', (raw) => {
    expect(parseGermanNumber(raw)).toBeNull()
  })
})

describe('parseEur', () => {
  it.each([
    ['EUR 245.000,00', 245_000],
    ['€ 1.250.000,--', 1_250_000],
    ['Euro 5', 5],
  ])('reads %s', (raw, expected) => {
    expect(parseEur(raw)).toBe(expected)
  })
})

describe('parseSqm', () => {
  // immoradar's parser read "3.353 m²" as 3.35.
  it.each([
    ['3.353 m²', 3353],
    ['1.234,56 m²', 1234.56],
    ['65,76 m²', 65.76],
    ['ca. 120 m2', 120],
  ])('reads %s', (raw, expected) => {
    expect(parseSqm(raw)).toBe(expected)
  })
})

describe('findSqmMentions', () => {
  it('does not join a page number to the value next to it', () => {
    expect(findSqmMentions('Seite 5 120,50 m²').map((mention) => mention.sqm)).toEqual([120.5])
  })

  it('ignores per-m² units', () => {
    expect(findSqmMentions('HWB 45 kWh/m²a')).toEqual([])
  })
})
