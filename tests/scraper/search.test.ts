import { describe, expect, it } from 'vitest'
import { bezirkFromPlz } from '@shared/wien-bezirke'
import {
  buildSearchQuery,
  buildSearchUrl,
  parseSearchResults,
  splitPlace,
} from '../../src/main/scraper/search'
import { errorOf, readFixture } from './read-fixture'

describe('buildSearchQuery', () => {
  it('joins the clauses of the plan with AND', () => {
    expect(
      buildSearchQuery({
        bundesland: 'wien',
        categories: ['EW', 'WE'],
        maxValueEur: 300000,
        publishedSince: '2026-11-03',
      }),
    ).toBe(
      '([BL]=(0)) AND ([VKat]=(EW) | [VKat]=(WE)) AND ([NumVWert]<=300000) AND ([DATBM]>=03.11.2026)',
    )
  })

  it('builds the list URL without paging parameters', () => {
    expect(buildSearchUrl({ bundesland: 'stmk' })).toBe(
      'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/suchedi?SearchView&subf=eex&SearchOrder=4&SearchMax=4999&retfields=&ftquery=&query=(%5BBL%5D%3D(5))',
    )
  })
})

describe('parseSearchResults', () => {
  const result = parseSearchResults(readFixture('search-wien.html'), 'wien')

  it('reads as many rows as the page reports', () => {
    expect(result.totalHits).toBe(136)
    expect(result.rows).toHaveLength(136)
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(136)
    const counts: Record<string, number> = {}
    for (const row of result.rows) counts[row.noticeType] = (counts[row.noticeType] ?? 0) + 1
    expect(counts).toEqual({
      versteigerung: 98,
      meistbotsverteilung: 26,
      zuschlag_ohne_ueberbot: 5,
      zuschlag_mit_ueberbot: 1,
      entfall: 4,
      verschiebung: 1,
      schriftliche_anbote: 1,
    })
  })

  it('takes each postcode from its own row', () => {
    for (const row of result.rows) {
      expect(row.plz).toBe(/^(\d{4})\b/.exec(row.addressText)?.[1] ?? null)
      expect(row).toMatchObject({ city: 'Wien', bundesland: 'wien' })
      expect(bezirkFromPlz(row.plz)).not.toBeNull()
    }
  })

  it('reads notice dates, postponements and Zuschlag rows', () => {
    expect(result.rows[0]).toMatchObject({
      noticeType: 'meistbotsverteilung',
      eventDate: '2026-11-04',
      previousDate: null,
      plz: '1030',
      street: 'Musterstraße 1',
      categoryLabel: null,
      title: 'KFZ-Stellplatz PP 46',
    })
    expect(result.rows.find((row) => row.noticeType === 'verschiebung')).toMatchObject({
      eventDate: '2026-12-14',
      previousDate: '2026-12-17',
      street: 'Kastaniengasse 66',
    })
    expect(result.rows.find((row) => row.title === 'Büro Top 4')).toMatchObject({
      id: '0213093e193620c56da82d3883b1b3af',
      url: 'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/alldoc/0213093e193620c56da82d3883b1b3af!OpenDocument',
      noticeType: 'zuschlag_ohne_ueberbot',
      eventDate: null,
      categoryLabel: 'Wohnungseigentumsobjekt, Maisonette',
      categoryCodes: ['WE', 'MAI'],
    })
  })

  it('leaves the postcode empty when a row has none', () => {
    const cells = (id: string, place: string) =>
      `<tr><td></td><td><a href="alldoc/${id}!OpenDocument">Versteigerung (01.12.2026)</a></td><td>${place}<br>Eigentumswohnung</td><td>Wohnung</td></tr>`
    const html = `<input name="Hits" value="2"><table><tbody>${cells('1'.repeat(32), '1030 Wien Musterstraße 1')}${cells('2'.repeat(32), 'Wien Beispielgasse 2')}</tbody></table>`
    const [first, second] = parseSearchResults(html).rows
    expect(first?.plz).toBe('1030')
    expect(second).toMatchObject({ plz: null, city: 'Wien', street: 'Beispielgasse 2' })
  })

  it('rejects a page whose rows do not match the reported hits', () => {
    const html = readFixture('search-wien.html').replace(
      'name="Hits" value="136"',
      'name="Hits" value="137"',
    )
    expect(errorOf(() => parseSearchResults(html))).toMatchObject({ code: 'site_changed' })
  })
})

describe('splitPlace', () => {
  it.each([
    ['1030 Wien Musterstraße 1', '1030', 'Wien', 'Musterstraße 1'],
    ['1100 Wien', '1100', 'Wien', null],
    ['8354 St. Anna am Aigen Hügelweg 34', '8354', 'St. Anna am Aigen', 'Hügelweg 34'],
    ['8650  Kindberg Beispielstraße 10', '8650', 'Kindberg', 'Beispielstraße 10'],
    ['8242 Auerbach ', '8242', 'Auerbach', null],
    ['8242 Auerbach 12', '8242', 'Auerbach', 'Auerbach 12'],
    [
      '2700 Wiener Neustadt Neunkirchner Straße 12',
      '2700',
      'Wiener Neustadt',
      'Neunkirchner Straße 12',
    ],
    ['2540 Bad Vöslau Am Kanal 3', '2540', 'Bad Vöslau', 'Am Kanal 3'],
    ['4020 Linz Untere Donaulände 7', '4020', 'Linz', 'Untere Donaulände 7'],
  ])('splits "%s"', (text, plz, city, street) => {
    expect(splitPlace(text)).toEqual({ plz, city, street })
  })
})
