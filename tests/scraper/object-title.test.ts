import { describe, expect, it } from 'vitest'
import { approximationFromTitle, propertyTypeFor } from '../../src/main/scraper/object-title'
import { parseSearchResults } from '../../src/main/scraper/search'
import { readFixture } from './read-fixture'

describe('propertyTypeFor', () => {
  it.each([
    ['KFZ-Abstellplatz 21', 'other'],
    ['Stapelstellplatz 22', 'other'],
    ['Stiege 1 Magazin IV', 'other'],
    ['Lager 1', 'other'],
    ['Tankstelle', 'commercial'],
    ['Geschäftslokal 4+Büro 5+Lager', 'commercial'],
    ['Abstellraum R1 und Büro 5-8', 'commercial'],
    ['Wohnung W 1 und KFZ-Abstellplatz 21', 'apartment'],
    ['Wohnungen W61-W63, KFZ-Abst.18', 'apartment'],
    ['Garçonnière Top 3', 'apartment'],
    ['Top 9', 'apartment'],
  ])('reads "%s" in category WE as %s', (title, type) => {
    expect(propertyTypeFor(['WE'], title)).toBe(type)
  })

  it('reads decomposed umlauts like composed ones', () => {
    expect(propertyTypeFor(['EW'], 'Geschäftslokal'.normalize('NFD'))).toBe('commercial')
  })

  it('refines only the apartment categories', () => {
    expect(propertyTypeFor(['RH', 'WE'], 'Atriumhaus W 13')).toBe('house')
    expect(propertyTypeFor(['GL'], 'Wohnung W 1')).toBe('commercial')
    expect(propertyTypeFor([], 'Wohnung')).toBe('other')
  })

  it('finds the parking spaces, shops and storage rooms among the flats of the Wien list', () => {
    const rows = parseSearchResults(readFixture('search-wien.html'), 'wien').rows.filter((row) =>
      row.categoryCodes.some((code) => code === 'WE' || code === 'EW'),
    )
    const notFlats = rows.filter((row) =>
      ['commercial', 'other'].includes(propertyTypeFor(row.categoryCodes, row.title)),
    )
    expect([rows.length, notFlats.length]).toEqual([90, 29])
  })
})

describe('approximationFromTitle', () => {
  const none = { partialOwnership: false, multipleUnits: false, bundledParking: false }

  it.each([
    ['Wohnung W 1+2, ER 1+2', ['EW'], { multipleUnits: true }],
    ['Geschäftslokal 1-4', ['WE'], { multipleUnits: true }],
    ['Wohnung 6 und 8', ['WE'], { multipleUnits: true }],
    ['Wohnungseigentumsobjekte', ['WE'], { multipleUnits: true }],
    ['Wohnung W 1 und KFZ-Abstellplatz 21', ['WE'], { bundledParking: true }],
    ['Haus', ['HAN'], { partialOwnership: true }],
    ['schlichtes Miteigentum', [], { partialOwnership: true }],
    ['Hälfteanteil an Wohnung W 4', ['EW'], { partialOwnership: true }],
    ['Miteigentumsanteil verbunden mit Wohnungseigentum an W 7', ['WE'], {}],
    ['Wohnung W 4, ER 4', ['EW'], {}],
    ['Top 17', ['WE'], {}],
  ])('reads "%s"', (title, codes, expected) => {
    expect(approximationFromTitle(title, codes)).toEqual({ ...none, ...expected })
  })
})
