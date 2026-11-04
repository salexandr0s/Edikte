import { describe, expect, it } from 'vitest'
import { detectTextPages, layoutPage, type TextRun } from '../../src/main/documents/page-text'

// Runs in viewport space: y grows downwards on an A4 page 842 points high.
function run(text: string, x: number, y: number): TextRun {
  return { text, x, y, width: text.length * 5, size: 10, horizontal: true }
}

describe('printed page labels', () => {
  it.each([
    { footer: 'Seite 42', label: 'Seite 42' },
    { footer: 'Stand: 18.11.2024 Seite 8 von 18', label: 'Seite 8 von 18' },
    { footer: '- 42 -', label: '- 42 -' },
  ])('reads "$footer" as "$label"', ({ footer, label }) => {
    const layout = layoutPage([run('Befund', 72, 80), run(footer, 300, 820)], 842)
    expect(layout.printedLabel).toBe(label)
  })

  it('ignores page references in the body text', () => {
    expect(layoutPage([run('siehe Seite 12 des Gutachtens', 72, 400)], 842).printedLabel).toBeNull()
  })
})

describe('detectTextPages', () => {
  it('does not count headers and footers repeated across pages as text', () => {
    const header =
      'Allgemein beeideter und gerichtlich zertifizierter Sachverständiger für Immobilien'
    const body =
      'Die Wohnung liegt im dritten Stock eines gepflegten Hauses und besteht aus drei Zimmern, ' +
      'Küche und Bad. Das Haus wurde im Jahr 1976 errichtet und zuletzt im Jahr 2015 umfassend saniert.'
    const pages = [
      [header, body, 'Seite 1'],
      [header, 'Seite 2'],
      [header, body, 'Seite 3'],
      [header, 'Seite 4'],
    ]
    expect(detectTextPages(pages)).toEqual([true, false, true, false])
  })
})
