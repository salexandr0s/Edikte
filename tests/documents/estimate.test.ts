import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { estimateArea, type EstimatePage } from '../../src/main/documents/estimate'

// Page texts as extract.ts lays them out, trimmed to the relevant lines, with
// street names, land-register numbers and the expert's name replaced.
function fixture(name: string, pageNumber: number): EstimatePage {
  const text = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').trim()
  return { pageNumber, text }
}

const apartment = [
  fixture('apartment-p08.txt', 8),
  fixture('apartment-p13.txt', 13),
  fixture('apartment-p14.txt', 14),
]

describe('estimateArea', () => {
  it('takes the apartment area from page 8 and not from the comparables', () => {
    expect(estimateArea(apartment, 'apartment')).toEqual({
      kind: 'nutzflaeche',
      sqm: 65.76,
      page: 8,
      quote: 'Nutzfläche Wohnung Top 24: 65,76 m²',
      confidence: 'medium',
      method: 'text-scan:same-line',
    })
  })

  it('skips comparables pages', () => {
    const comparables = apartment.slice(1)
    expect(estimateArea(comparables, 'apartment')).toBeNull()
    // Without their headings the same pages would yield an area.
    const unmarked = comparables.map((page) => ({
      ...page,
      text: page.text.replace(/Vergleich\p{L}*/gu, 'Objekt'),
    }))
    expect(estimateArea(unmarked, 'apartment')).not.toBeNull()
  })

  it('rates a floor total that includes the cellar as low confidence', () => {
    expect(estimateArea([fixture('house-p33.txt', 33)], 'house')).toEqual({
      kind: 'nutzflaeche',
      sqm: 135.93,
      page: 33,
      quote: 'Kellergeschoss 64,92 m²\nHauptgeschoss 71,01 m²\nGesamt 135,93 m²',
      confidence: 'low',
      method: 'text-scan:block-total',
    })
  })

  it('uses the plot area only for property types measured by plot', () => {
    const plot = { pageNumber: 2, text: 'Grundstücksfläche der Liegenschaft EZ 123 942 m²' }
    expect(estimateArea([plot], 'apartment')).toBeNull()
    expect(estimateArea([plot], 'land')).toMatchObject({ kind: 'grundflaeche', sqm: 942 })
  })
})
