import { describe, expect, it } from 'vitest'
import { EvidenceStatusSchema, type EvidenceItem } from '@shared/analysis-schema'
import {
  checkEvidence,
  evidenceChecker,
  normalizeForMatch,
  numbersIn,
} from '../../../src/main/ai/analysis/evidence'
import { houseAnswer, housePages } from './helpers'

function statuses(evidence: readonly EvidenceItem[]): Record<string, string> {
  return Object.fromEntries(evidence.map((item) => [item.path, item.status]))
}

describe('checkEvidence', () => {
  it('gives every quoted fact a status', () => {
    const evidence = checkEvidence(houseAnswer, { pages: housePages, imagePages: [6] })
    expect(statuses(evidence)).toEqual({
      // The page has a no-break space before m².
      'areas.0': 'verified',
      // The quote writes m2 for m².
      'areas.1': 'verified',
      'areas.2': 'number_mismatch',
      verkehrswert: 'verified',
      tenancy: 'no_quote',
      'encumbrances.0': 'verified',
      'arrears.0': 'verified',
      'defects.0': 'quote_not_found',
      'defects.1': 'scanned_page',
      // Cites the printed "Seite 5", which is PDF page 7.
      'defects.2': 'wrong_page',
      // Hyphenated across a line break on the page.
      'risks.0': 'verified',
      'risks.1': 'page_out_of_range',
    })
    expect(new Set(evidence.map((item) => item.status))).toEqual(
      new Set(EvidenceStatusSchema.options),
    )
    expect(evidence.find((item) => item.path === 'defects.2')?.page).toBe(7)
  })

  it('rejects a quote from a scanned page the model never saw', () => {
    const evidence = checkEvidence(houseAnswer, { pages: housePages, imagePages: [] })
    expect(statuses(evidence)['defects.1']).toBe('quote_not_found')
  })

  it('accepts parts joined with an ellipsis when each part is on the page', () => {
    const check = evidenceChecker({
      pages: [
        {
          pageNumber: 1,
          printedLabel: null,
          hasText: true,
          text: 'Verkehrswert\n(gerundet)\nsiehe Tabelle 3\n€ 556.000,00',
        },
      ],
      imagePages: [],
    })
    const claim = { path: 'verkehrswert', page: 1 }
    expect(
      check({ ...claim, quote: 'Verkehrswert (gerundet) … € 556.000,00', value: 556_000 }).status,
    ).toBe('verified')
    expect(check({ ...claim, quote: 'Verkehrswert [...] € 565.000', value: 565_000 }).status).toBe(
      'quote_not_found',
    )
    expect(check({ ...claim, quote: '…', value: null }).status).toBe('no_quote')
  })
})

describe('normalizeForMatch', () => {
  it('treats layout differences between PDF text and quotes as equal', () => {
    expect(normalizeForMatch('71,01\u00A0m²')).toBe(normalizeForMatch('71,01 m2'))
    expect(normalizeForMatch('Keller-\ngeschoss')).toBe(normalizeForMatch('Kellergeschoss'))
    expect(normalizeForMatch('Kel\u00ADler')).toBe('keller')
    expect(normalizeForMatch('„Außenwände“ – Nord')).toBe(normalizeForMatch('"Aussenwände" - Nord'))
  })
})

describe('numbersIn', () => {
  it('reads German and English notation and skips dates', () => {
    expect(numbersIn('€ 1.234.567,89 am 12.03.2024')).toEqual([1_234_567.89])
    expect(numbersIn('556\u202F000 EUR, 64.92 m²')).toEqual([556_000, 64.92])
  })
})
