import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { estimateArea } from '../../src/main/documents/estimate'
import { extractPages } from '../../src/main/documents/extract'

// Checks against the real samples in corpus/, which stays out of the repo and
// out of CI; without it these tests are skipped.
const CORPUS = fileURLToPath(new URL('../../corpus/gutachten/', import.meta.url))

function sample(folder: string, prefix: string): string | null {
  const dir = path.join(CORPUS, folder)
  if (!existsSync(dir)) return null
  const name = readdirSync(dir).find(
    (entry) => entry.startsWith(prefix) && entry.toLowerCase().endsWith('.pdf'),
  )
  return name === undefined ? null : path.join(dir, name)
}

const apartment = sample('apartment', 'GZ-24143-1150')
const house = sample('house', 'GA_')

describe.skipIf(apartment === null)('apartment sample', () => {
  it('opens despite its empty-password encryption', { timeout: 30_000 }, async () => {
    const document = await extractPages(await readFile(apartment ?? ''))
    expect(document.pageCount).toBe(36)
    expect(document.pages[7]?.printedLabel).toBe('Seite 8 von 18')
    // Pages 20 to 36 are scans.
    expect(document.pages[29]?.hasText).toBe(false)
    expect(estimateArea(document.pages, 'apartment')).toMatchObject({
      sqm: 65.76,
      page: 8,
      confidence: 'medium',
    })
  })
})

describe.skipIf(house === null)('house sample', () => {
  it('reads printed page labels and the floor total', { timeout: 30_000 }, async () => {
    const document = await extractPages(await readFile(house ?? ''))
    expect(document.pageCount).toBe(65)
    expect(document.pages[45]?.printedLabel).toBe('Seite 42')
    expect(estimateArea(document.pages, 'house')).toMatchObject({
      sqm: 135.93,
      page: 33,
      confidence: 'low',
    })
  })
})
