import { describe, expect, it } from 'vitest'
import { insolvencySearchUrl } from '../../../src/main/scraper/insolvency/api'
import { parseInsolvencySearchPage } from '../../../src/main/scraper/insolvency/search'
import { errorOf } from '../read-fixture'
import { readJsonFixture } from './read-json-fixture'

describe('insolvencySearchUrl', () => {
  // Catches a filter that is missing or sent without URL encoding, and a first page sent as 0.
  it('sends the three filters as encoded JSON and counts pages from 1', () => {
    expect(insolvencySearchUrl({ bundesland: 'wien', page: 1 })).toBe(
      'https://justizonline.gv.at/jop/service/edi/v1/edikte' +
        '?filter=%7B%22id%22%3A%22ediktType%22%2C%22values%22%3A%5B%22MV%22%5D%7D' +
        '&filter=%7B%22id%22%3A%22mvBekanntmachungType%22%2C%22values%22%3A%5B%22LIEGENSCHAFT%22%5D%7D' +
        '&filter=%7B%22id%22%3A%22bl%22%2C%22values%22%3A%5B%22WIEN%22%5D%7D' +
        '&page=1&pageSize=100&sort=DATE_DESC',
    )
    const third = new URL(insolvencySearchUrl({ bundesland: 'noe', page: 3 })).searchParams
    expect(third.getAll('filter')[2]).toBe('{"id":"bl","values":["NIEDEROESTERREICH"]}')
    expect(third.get('page')).toBe('3')
    expect(() => insolvencySearchUrl({ bundesland: 'wien', page: 0 })).toThrow()
  })
})

describe('parseInsolvencySearchPage', () => {
  const page = parseInsolvencySearchPage(readJsonFixture('search-page.json'))

  // Catches a wrong ID or date, an absent updatedAt read as a date, and paging taken from the row count.
  it('reads IDs, dates and paging, and leaves an absent updatedAt null', () => {
    expect(page).toMatchObject({ page: 2, pageSize: 100, total: 104, incomplete: false })
    expect(page.rows).toEqual([
      {
        recordNumber: 990001,
        id: 'mv-990001',
        publishedAt: '2026-11-02',
        updatedAt: '2026-11-05',
        caseNumber: '099 4 S 12/26 x',
        court: 'HG Musterstadt',
      },
      {
        recordNumber: 990002,
        id: 'mv-990002',
        publishedAt: '2026-10-20',
        updatedAt: null,
        caseNumber: '099 5 S 34/26 y',
        court: 'HG Musterstadt',
      },
      {
        recordNumber: 990003,
        id: 'mv-990003',
        publishedAt: '2026-09-14',
        updatedAt: '2026-09-30',
        caseNumber: '098 7 S 56/25 z',
        court: 'LG Beispielstadt',
      },
    ])
  })

  // Catches one unreadable row failing the page, and such a row dropped without a trace.
  it('counts a row it cannot read as skipped', () => {
    expect(page.skipped).toHaveLength(1)
    expect(page.skipped[0]).toContain('row 4')
  })

  // Catches a cut-off list taken for a complete one.
  it('passes on the incomplete flag of the API', () => {
    const body = { page: 1, pageSize: 100, total: 0, incompleteResult: true, edikte: [] }
    expect(parseInsolvencySearchPage(body).incomplete).toBe(true)
  })

  // Catches an error page or a changed answer read as an empty list.
  it('reports a body that is not a search page as site_changed', () => {
    const bodies = [
      null,
      [],
      {},
      { page: 1, pageSize: 100, total: 0, incompleteResult: false },
      { page: 1, pageSize: 100, total: 0, edikte: [] },
    ]
    for (const body of bodies) {
      expect(errorOf(() => parseInsolvencySearchPage(body))).toMatchObject({ code: 'site_changed' })
    }
  })
})
