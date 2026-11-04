import { describe, expect, it } from 'vitest'
import { parseKurzgutachten } from '../../src/main/scraper/kurzgutachten'
import { readFixture } from './read-fixture'

describe('parseKurzgutachten', () => {
  it('reads the facts of a Vienna page', () => {
    const facts = parseKurzgutachten(readFixture('kurzgutachten-wien.html'))
    expect(facts).toMatchObject({
      anschluesse: 'Strom, Wasser, Kanal, Fernwärme',
      bestandsverhaeltnisse: 'unbefristet vermietet',
      stichtag: '2026-05-20',
      lasten: null,
      erstelltVon: null,
    })
    expect(facts?.other).toMatchObject({
      Aktenzeichen: '58 E 53/59m',
      Adresse: 'Musterstraße 50 Stiege 1 Top 25',
    })
  })

  it('keeps line breaks of multi-line values', () => {
    const facts = parseKurzgutachten(readFixture('kurzgutachten-stmk.html'))
    expect(facts).toMatchObject({
      baubewilligung: '13.11.1996 (Dachgeschoß)',
      widmung: 'Wohnen allgemein\n0,2 - 0,3',
      bestandsverhaeltnisse: 'eigengenutzt',
      stichtag: '2025-06-24',
    })
    expect(facts?.anschluesse?.split('\n')).toHaveLength(4)
  })

  it('maps labels not yet seen on live pages and skips unavailable values', () => {
    const html =
      '<div id="druckbereich"><div class="row"><span>Lasten:</span><p>Pfandrecht</p></div>' +
      '<div class="row"><span>Gutachten erstellt von:</span><p>Sachverständigenbüro Beispiel</p></div>' +
      '<div class="row"><span>Widmung:</span><p>nicht verfügbar</p></div></div>'
    expect(parseKurzgutachten(html)).toEqual({
      anschluesse: null,
      baubewilligung: null,
      widmung: null,
      bestandsverhaeltnisse: null,
      stichtag: null,
      lasten: 'Pfandrecht',
      erstelltVon: 'Sachverständigenbüro Beispiel',
      other: {},
    })
  })

  it('returns null for a page without facts', () => {
    expect(parseKurzgutachten('<html><body><p>Fehler</p></body></html>')).toBeNull()
  })
})
