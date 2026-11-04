import { describe, expect, it } from 'vitest'
import { buildCaseKey } from '../../src/main/scraper/case-key'
import { parseDetailPage } from '../../src/main/scraper/detail'
import { buildEdictRecord } from '../../src/main/scraper/edict-record'
import { assessRunHealth, type HealthSample } from '../../src/main/scraper/health'
import { PARSER_VERSION } from '../../src/main/scraper/parser-version'
import { parseSearchResults } from '../../src/main/scraper/search'
import { errorOf, readFixture } from './read-fixture'

const DOCS = 'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/0/'

describe('parseDetailPage', () => {
  it('reads an auction edict', () => {
    const detail = parseDetailPage(readFixture('detail-versteigerung.html'))
    expect(detail).toMatchObject({
      id: 'bd476b519c362491532c1dcd390db546',
      noticeType: 'versteigerung',
      noticeText: 'Versteigerung',
      objectTitle: 'Wohnung Stiege 1 Top 25',
      corrected: false,
      changeLog: [],
      related: [],
      kurzgutachtenUrl: `${DOCS}ebb3d8caa27bbdd0ed6d8f97110d4784`,
    })
    expect(detail.fields).toEqual({
      court: 'BG Leopoldstadt',
      courtCode: '082',
      caseNumber: '58 E 53/59m',
      publishedAt: '2026-10-02',
      changedAt: null,
      auctionAt: '2026-11-24T14:00',
      auctionPlace: '1020 Wien, Taborstr. 90-92, EG, Saal A',
      viewing: null,
      grundbuch: '01657 Leopoldstadt',
      ez: '2378',
      street: 'Musterstraße 50 Stiege 1 Top 25',
      plz: '1020',
      city: 'Wien',
      categoryLabel: 'Eigentumswohnung, Dachterrassenwohnung, Dachgeschoßwohnung',
      categoryCodes: ['EW', 'DTW', 'DGW'],
      grundstuecksgroesseSqm: 2908,
      objektgroesseSqm: 63.26,
      objektgroesseRaw: '63,26 m²',
      schaetzwertEur: 259000,
      geringstesGebotEur: 180000,
      vadiumEur: 25900,
      meistbotEur: null,
      zubehoer: 'kein Zubehör',
      remarks:
        'dem Langgutachten sind Plan- und Fotodokumentation sowie der Mietvertrag angeschlossen',
    })
    expect(detail.documents).toEqual([
      {
        kind: 'langgutachten',
        title: 'Langgutachten',
        fileName: 'Datei 1.pdf',
        url: `${DOCS}f8f7c3e83c7c6fa6c4615996dd76e3ea/$file/Datei%201.pdf`,
        statedSizeKb: 8579,
      },
      {
        kind: 'other',
        title: 'Mietvertrag',
        fileName: 'Datei 2.pdf',
        url: `${DOCS}748eb860c67661d26dc3ea2eb47c8cea/$file/Datei%202.pdf`,
        statedSizeKb: 2719,
      },
    ])
    expect(detail.rawLabels).toMatchObject({
      Dienststelle: 'BG Leopoldstadt (082)',
      Lageplan: 'nicht verfügbar',
    })
  })

  it('reads the winning bid and land register of a Zuschlag', () => {
    const detail = parseDetailPage(readFixture('detail-zuschlag.html'))
    expect(detail).toMatchObject({
      id: '0213093e193620c56da82d3883b1b3af',
      noticeType: 'zuschlag_ohne_ueberbot',
      objectTitle: 'Büro Top 4',
      documents: [],
      kurzgutachtenUrl: null,
    })
    expect(detail.fields).toMatchObject({
      court: 'BG Innere Stadt Wien',
      courtCode: '001',
      caseNumber: '07 E 96/58f',
      publishedAt: '2026-10-20',
      grundbuch: '01009 Mariahilf',
      ez: '908',
      meistbotEur: 440000,
      auctionAt: null,
      schaetzwertEur: null,
    })
    expect(detail.related).toEqual([
      {
        id: null,
        noticeType: 'zuschlag_ohne_ueberbot',
        text: 'Zuschlag ohne Überbot Büro Top 4',
        eventAt: null,
        address: null,
      },
      {
        id: 'fe3722c48826b19ce060c8eb8035828f',
        noticeType: 'zuschlag_ohne_ueberbot',
        text: 'Zuschlag ohne Überbot Büro Top 5',
        eventAt: null,
        address: null,
      },
    ])
  })

  it('reads the change log, banner and case chain of a corrected edict', () => {
    const detail = parseDetailPage(readFixture('detail-changelog.html'))
    expect(detail).toMatchObject({ objectTitle: 'Geschäftslokal 3', corrected: true })
    expect(detail.fields).toMatchObject({
      caseNumber: '07 E 58/57s',
      changedAt: '2026-02-19',
      auctionAt: '2026-04-15T10:30',
      plz: '1110',
      street: 'Beispielgasse 12-14 / Musterweg 1',
      categoryCodes: ['WE'],
      grundstuecksgroesseSqm: 2551,
      objektgroesseSqm: 180,
      schaetzwertEur: 3347000,
      vadiumEur: 334700,
      geringstesGebotEur: 1673500,
    })
    expect(detail.changeLog).toEqual([
      {
        publishedAt: '2026-02-19',
        title: 'Sonstiges Edikt',
        field: 'Geringstes Gebot',
        oldValue: '1.673.000,00',
        newValue: '1.673.500,00',
        text: '"Geringstes Gebot" von 1.673.000,00 auf 1.673.500,00 geändert.',
      },
    ])
    expect(detail.related).toHaveLength(3)
    expect(detail.related[0]).toEqual({
      id: 'dd1ebafdda56caac1d875d1634e880d5',
      noticeType: 'versteigerung',
      text: 'Versteigerung Geschäftslokal 1 (15.04.2026 10:30)',
      eventAt: '2026-04-15T10:30',
      address: '1110 Wien, Beispielgasse 12-14 / Musterweg 1',
    })
    expect(detail.related[2]?.id).toBeNull()
    expect(detail.documents.map((document) => document.kind)).toEqual([
      'langgutachten',
      'other',
      'plan',
      'plan',
      'plan',
      'photo',
      'photo',
    ])
    expect(detail.documents[1]).toMatchObject({ title: 'Beilagen', statedSizeKb: 37000 })
  })

  it('reads a cancelled auction and its postponement history', () => {
    const detail = parseDetailPage(readFixture('detail-entfall.html'))
    expect(detail).toMatchObject({
      noticeType: 'entfall',
      objectTitle: 'KFZ Stellplatz Stapelparker 29',
      corrected: true,
    })
    expect(detail.fields).toMatchObject({
      court: 'BG Donaustadt',
      courtCode: '027',
      changedAt: '2026-03-12',
      auctionAt: '2026-05-05T09:00',
      plz: '1220',
      street: 'Ulmenweg 6/Lindenstraße 116',
      schaetzwertEur: 135000,
      zubehoer: 'nicht festgestellt',
      objektgroesseSqm: null,
    })
    expect(detail.related).toHaveLength(10)
    expect(detail.changeLog).toMatchObject([
      {
        publishedAt: '2026-01-28',
        title: 'Verschiebung',
        field: null,
        oldValue: '17.02.2026 um 10:30 Uhr',
        newValue: '05.05.2026 um 09:00 Uhr',
      },
      {
        publishedAt: '2026-03-12',
        title: 'Entfall des Termins',
        field: null,
        oldValue: '05.05.2026 um 09:00 Uhr',
        newValue: null,
      },
    ])
  })

  it('takes the new date of a postponed auction', () => {
    const detail = parseDetailPage(readFixture('detail-verschiebung.html'))
    expect(detail).toMatchObject({
      noticeType: 'verschiebung',
      objectTitle: 'Geschäftslokal Top 1-5',
      corrected: true,
    })
    expect(detail.fields).toMatchObject({
      court: 'BG Döbling',
      caseNumber: '59 E 50/57y',
      changedAt: '2026-03-16',
      auctionAt: '2026-06-24T09:30',
      plz: '1180',
      street: 'Fliedergasse 10',
      objektgroesseSqm: 112.64,
      schaetzwertEur: 470000,
      vadiumEur: 47000,
      geringstesGebotEur: 235000,
    })
    expect(detail.rawLabels['Ehemaliger Termin']).toContain('18.03.2026')
    expect(detail.related).toHaveLength(2)
    expect(detail.changeLog).toHaveLength(3)
  })

  it('reads a Meistbotsverteilung without object title', () => {
    const detail = parseDetailPage(readFixture('detail-meistbotsverteilung.html'))
    expect(detail).toMatchObject({
      noticeType: 'meistbotsverteilung',
      noticeText: 'Meistbotsverteilung',
      objectTitle: null,
    })
    expect(detail.fields).toMatchObject({
      court: 'BG Floridsdorf',
      caseNumber: '11 E 59/57k',
      publishedAt: '2026-03-30',
      meistbotEur: 368000,
      auctionAt: null,
      grundbuch: '01613 Leopoldau',
      ez: '2850',
      street: 'Rosenweg 25',
      plz: '1210',
      city: 'Wien',
    })
    expect(detail.related.map((entry) => entry.eventAt)).toContain('2026-04-27T13:03')
  })

  it('leaves the object size empty when the page has none', () => {
    const detail = parseDetailPage(readFixture('detail-no-objektgroesse.html'))
    expect(detail.fields).toMatchObject({
      objektgroesseSqm: null,
      objektgroesseRaw: null,
      grundstuecksgroesseSqm: 71.91,
      auctionAt: '2026-04-29T10:30',
      plz: '1050',
      street: 'Lindengasse 14 ident Ahornweg 8',
      categoryCodes: ['EW'],
      schaetzwertEur: 238000,
      vadiumEur: 23800,
      geringstesGebotEur: 119000,
    })
    expect(detail.documents.map((document) => document.kind)).toEqual([
      'langgutachten',
      'plan',
      'plan',
      'plan',
      'plan',
      'plan',
      'photo',
    ])
    expect(detail.related).toHaveLength(4)
  })

  it('reads plans and photos and a missing Kurzgutachten', () => {
    const detail = parseDetailPage(readFixture('detail-donaustadt.html'))
    expect(detail).toMatchObject({ objectTitle: 'Objekt 0', kurzgutachtenUrl: null, related: [] })
    expect(detail.fields).toMatchObject({
      court: 'BG Donaustadt',
      caseNumber: '91 E 66/58a',
      publishedAt: '2026-02-25',
      auctionAt: '2026-03-24T09:00',
      grundbuch: '01654 Bezirksgericht Donaustadt',
      ez: '1456',
      plz: '1220',
      city: 'Wien',
      street: null,
      categoryCodes: ['RH'],
      grundstuecksgroesseSqm: 3353,
      objektgroesseSqm: 85.22,
      schaetzwertEur: 382000,
      vadiumEur: 38200,
      geringstesGebotEur: 191000,
      zubehoer: 'kein Zubehör',
      remarks: 'Unter dem geringsten Gebot findet ein Verkauf nicht statt.',
    })
    expect(detail.documents.map((document) => [document.kind, document.statedSizeKb])).toEqual([
      ['langgutachten', 4327],
      ['plan', 115],
      ['plan', 6454],
      ['photo', expect.any(Number)],
      ['photo', expect.any(Number)],
    ])
    expect(detail.documents.filter((document) => document.kind === 'photo')).toMatchObject([
      { title: 'Foto' },
      { title: 'Foto' },
    ])
  })

  it('reads a page outside Vienna with a correction banner', () => {
    const detail = parseDetailPage(readFixture('detail-stmk.html'))
    expect(detail.corrected).toBe(true)
    expect(detail.fields).toMatchObject({
      court: 'BG Feldbach',
      courtCode: '620',
      caseNumber: '48 E 1/58d',
      changedAt: '2026-10-21',
      auctionAt: '2026-11-11T09:00',
      street: 'Hügelweg 7',
      plz: '8354',
      city: 'St. Anna am Aigen',
      categoryCodes: ['EH'],
      grundstuecksgroesseSqm: 3244,
      objektgroesseSqm: 140,
      schaetzwertEur: 113500,
      vadiumEur: 11350,
      geringstesGebotEur: 56750,
    })
    expect(detail.fields.zubehoer).toContain('3.000,00')
    expect(detail.changeLog).toMatchObject([
      {
        publishedAt: '2026-10-21',
        field: 'Ort und Zeit der Besichtigung',
        oldValue: null,
        newValue: '3.11.2026, 9.00 Uhr',
      },
    ])
    expect(detail.documents.map((document) => document.kind)).toEqual([
      'langgutachten',
      'langgutachten',
      'plan',
      'plan',
      'plan',
      'plan',
      'photo',
      'photo',
    ])
  })

  it('reports a deleted edict as not found and an empty page as a site change', () => {
    const deleted =
      '<html><head><title>Gerichtliche Versteigerungen - Fehler</title></head><body><p>Das gewünschte Dokument wurde nicht gefunden.</p></body></html>'
    expect(errorOf(() => parseDetailPage(deleted))).toMatchObject({ code: 'not_found' })
    expect(errorOf(() => parseDetailPage('<html><body></body></html>'))).toMatchObject({
      code: 'site_changed',
    })
  })

  it('hashes only the content area', () => {
    const html = readFixture('detail-versteigerung.html')
    const hash = parseDetailPage(html).contentHash
    expect(parseDetailPage(html.replace('Lesezeichen', 'Bookmark')).contentHash).toBe(hash)
    expect(parseDetailPage(html.replace('180.000,00', '170.000,00')).contentHash).not.toBe(hash)
  })
})

describe('buildCaseKey', () => {
  const base = { court: 'BG Leopoldstadt (082)', caseNumber: '58 E 53/59m', id: 'a' }

  it('ignores spacing, punctuation, case and the court code', () => {
    const key = buildCaseKey({ ...base, object: 'Wohnung Stiege 1, Top 25' })
    expect(key).toBe('bg leopoldstadt|58 e 53/59m|wohnung stiege 1 top 25')
    expect(
      buildCaseKey({
        court: 'BG Leopoldstadt',
        caseNumber: '58  E 53/59m',
        object: 'wohnung Stiege 1 Top 25',
        id: 'b',
      }),
    ).toBe(key)
  })

  it('keeps different objects apart', () => {
    expect(buildCaseKey({ ...base, object: 'Top 1, 2' })).not.toBe(
      buildCaseKey({ ...base, object: 'Top 12' }),
    )
  })

  it('falls back to the edict ID without court or case number', () => {
    expect(buildCaseKey({ ...base, court: null, object: 'Haus' })).toBe('edict:a')
  })
})

describe('buildEdictRecord', () => {
  it('fills gaps of a Zuschlag page from its list row', () => {
    const id = '0213093e193620c56da82d3883b1b3af'
    const row = parseSearchResults(readFixture('search-wien.html'), 'wien').rows.find(
      (entry) => entry.id === id,
    )
    const record = buildEdictRecord({
      id,
      detail: parseDetailPage(readFixture('detail-zuschlag.html')),
      row,
      fetchedAt: '2026-11-04T22:00:00.000Z',
    })
    expect(record).toMatchObject({
      status: 'sold',
      propertyType: 'apartment',
      categoryCodes: ['WE', 'MAI'],
      title: 'Büro Top 4',
      street: 'Birkenallee 77',
      plz: '1060',
      city: 'Wien',
      bezirk: 6,
      bundesland: 'wien',
      meistbotEur: 440000,
      relatedIds: ['fe3722c48826b19ce060c8eb8035828f'],
      caseKey: 'bg innere stadt wien|07 e 96/58f|büro top 4',
      parserVersion: PARSER_VERSION,
      firstSeenAt: '2026-11-04T22:00:00.000Z',
      removedAt: null,
      kurzgutachten: null,
    })
  })
})

describe('assessRunHealth', () => {
  const auction = (caseNumber: string | null, schaetzwertEur: number | null): HealthSample => ({
    noticeType: 'versteigerung',
    caseNumber,
    schaetzwertEur,
  })
  const good = (count: number) => Array.from({ length: count }, () => auction('1 E 1/26a', 1))

  it('accepts a few gaps and flags many', () => {
    expect(assessRunHealth([...good(9), auction('1 E 2/26a', null)]).degraded).toBe(false)
    const health = assessRunHealth([
      ...good(7),
      auction(null, 1),
      auction(null, 1),
      auction(null, 1),
    ])
    expect(health).toMatchObject({ versteigerungPages: 10, missingCaseNumber: 3, degraded: true })
    expect(health.note).toContain('case number')
  })

  it('judges a small sample only when every page fails', () => {
    expect(assessRunHealth([auction('1 E 1/26a', null), auction('1 E 2/26a', 1)]).degraded).toBe(
      false,
    )
    expect(assessRunHealth([auction(null, null), auction(null, null)]).degraded).toBe(true)
  })

  it('counts only auction notices', () => {
    const sold: HealthSample = {
      noticeType: 'zuschlag_ohne_ueberbot',
      caseNumber: '1 E 1/26a',
      schaetzwertEur: null,
    }
    expect(assessRunHealth([sold, sold, sold]).degraded).toBe(false)
  })
})
