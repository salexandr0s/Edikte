import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { DocumentLinkSchema } from '../../../src/main/scraper/detail'
import {
  insolvencyDetailUrl,
  insolvencyFileUrl,
  insolvencyPublicUrl,
} from '../../../src/main/scraper/insolvency/api'
import { parseInsolvencyDetail } from '../../../src/main/scraper/insolvency/detail'
import { errorOf } from '../read-fixture'
import { readJsonFixture } from './read-json-fixture'

const FILES = 'https://justizonline.gv.at/jop/service/edi/v1/edikte/990001/resources/'

/** A record with the given sections, for cases the fixtures do not hold. */
function record(sections: unknown[], id = 990009): unknown {
  return { edikt: { id, sections } }
}

function list(title: string, values: Record<string, string>): unknown {
  const items = Object.entries(values).map(([heading, text]) => ({ heading, text }))
  return { title, elements: [{ type: 'LIST', items }] }
}

function files(title: string, names: string[]): unknown {
  const items = names.map((fileName) => {
    // The token differs per section and name, so no file counts as a duplicate.
    const token = Buffer.from(`${title}/${fileName}`).toString('base64url')
    return {
      fileName,
      fileUrl: `service/edi/v1/edikte/990009/resources/${token}`,
      fileSize: 2048,
      mimeType: 'application/pdf',
      deleted: false,
    }
  })
  return { title, elements: [{ type: 'FILE_LIST', items }] }
}

/** Checks that the fixture holds each text and that the parsed record holds none of them. */
function expectLeftOut(fixture: string, recordNumber: number, texts: string[]): void {
  const published = JSON.stringify(readJsonFixture(fixture))
  const kept = JSON.stringify(parseInsolvencyDetail(readJsonFixture(fixture), recordNumber))
  for (const text of texts) {
    expect(published).toContain(text)
    expect(kept).not.toContain(text)
  }
}

describe('parseInsolvencyDetail on a record with every section', () => {
  const detail = parseInsolvencyDetail(readJsonFixture('detail-rich.json'), 990001)

  // Catches a heading mapped to the wrong field, and an area or amount read in the wrong notation.
  it('maps the notice and the property', () => {
    expect(detail).toMatchObject({
      recordNumber: 990001,
      court: 'HG Musterstadt',
      caseNumber: '099 4 S 12/26 x',
      publishedAt: '2026-11-02',
      changedAt: '2026-11-05',
      announcementKind: 'Liegenschaft',
      transactionText: 'Veräußerung',
      transaction: 'sale',
      street: 'Beispielgasse 1',
      plz: '3999',
      city: 'Musterstadt',
      bundeslandName: 'Niederösterreich',
      bundesland: 'noe',
      title: 'Mietshaus mit sechs Wohnungen',
      description:
        'Dreigeschoßiges Mietshaus mit sechs Wohnungen und Garten.\nBesichtigung nach Vereinbarung mit der Kanzlei.',
      categoryLabel: 'Mietshaus, Gemischt genutztes Haus, Luftschloss',
      categoryCodes: ['MSH', 'GGH'],
      grundbuch: '09999',
      grundbuchgericht: 'BG Musterstadt',
      ez: '123',
      grundstuecksnr: '45/6',
      blnr: '7',
      grundstuecksgroesseSqm: 9876,
      objektgroesseSqm: 458.04,
      objektgroesseRaw: '458,04 m²',
      valueEur: 1350000,
      zubehoer: 'Einbauküchen in zwei Wohnungen\n€ 4 000,00',
      link: 'https://www.example.at/beispielgasse-1',
      missing: [],
    })
  })

  // Catches a fact or a contact filed under the wrong key, and a mail link stored with its prefix.
  it('reads the stated facts and both contacts', () => {
    expect(detail.facts).toEqual({
      anschluesse: 'Kanal, Wasser, Strom und Gas',
      baubewilligung: 'Bescheid vom 3.5.1962',
      widmung: 'Bauland Wohngebiet',
      bestandsverhaeltnisse: 'Vier Wohnungen sind unbefristet vermietet.',
      stichtag: null,
      lasten: 'Pfandrecht im Höchstbetrag von 200.000 EUR',
      erstelltVon: null,
      other: { Benützungsbewilligung: 'Bescheid vom 9.9.1963' },
    })
    expect(detail.administrator).toEqual({
      name: 'Dr. Erika Beispiel',
      address: 'Kanzleiplatz 2, 3999 Musterstadt',
      phone: '+43 1 555 01 00',
      fax: '+43 1 555 01 09',
      email: 'kanzlei@example.at',
    })
    expect(detail.deputy).toEqual({
      name: 'Mag. Jonas Vorlage',
      address: 'Kanzleiplatz 2, 3999 Musterstadt',
      phone: '+43 1 555 01 01',
      fax: null,
      email: 'vertretung@example.at',
    })
  })

  // Catches a heading lost from the raw labels, the two contacts overwriting each other's headings, and a timestamp shown where the user expects a date.
  it('keeps every filled heading as a raw label', () => {
    expect(Object.keys(detail.rawLabels)).toHaveLength(41)
    expect(detail.rawLabels).toMatchObject({
      Dienststelle: 'HG Musterstadt (099)',
      Bekanntmachungsdatum: '02.11.2026',
      'Letzte Änderung': '05.11.2026',
      'Wert des Objekts': '€ 1 350 000,00',
      'Insolvenzverwalter:in: Name': 'Dr. Erika Beispiel',
      'Stellvertreter:in: Name': 'Mag. Jonas Vorlage',
      'Stellvertreter:in: E-Mail': 'mailto:vertretung@example.at',
    })
  })

  // Catches photos or an annex offered for analysis as the report, and a restructuring plan filed as a drawing.
  it('lists the PDFs with their kinds and sizes', () => {
    expect(
      detail.documents.map((file) => [file.kind, file.title, file.fileName, file.statedSizeKb]),
    ).toEqual([
      ['langgutachten', 'Gutachten', 'Gutachten.pdf', 5421],
      ['photo', 'Fotos zum Gutachten', 'Fotos zum Gutachten.pdf', 2048],
      ['other', 'Beilage zum Gutachten', 'Beilage zum Gutachten.pdf', 28],
      ['other', 'Verwertungsbedingungen', 'Verwertungsbedingungen.pdf', 500],
      ['plan', 'Plan Erdgeschoß', 'Plan Erdgeschoß.pdf', 1025],
      ['other', 'Sanierungsplan', 'Sanierungsplan.pdf', 200],
      ['photo', 'Lichtbildbeilage', 'Lichtbildbeilage.pdf', 10240],
    ])
    expect(detail.documents[0]?.url).toBe(`${FILES}TVZfOTkwMDAxX0dBXzAwMDFfR3V0YWNodGVuLnBkZg`)
    // The stores take these links as they take the auction parser's.
    expect(detail.documents.map((file) => DocumentLinkSchema.parse(file))).toEqual(detail.documents)
  })

  // Catches a deleted file, a Word file or the file of another record reaching the download list.
  it('counts the files it leaves out', () => {
    expect(detail.skippedFiles).toEqual({ deleted: 1, notPdf: 1, foreignUrl: 1, unreadable: 0 })
    expect(detail.documents.every((file) => file.url.startsWith(FILES))).toBe(true)
  })

  // Catches a change filed under the wrong date, operation or name, a note about the property's address taken for the debtor's, and a value or the text of a note reaching the database through the change log.
  it('reads the history without the changes to the debtor', () => {
    const empty = { oldValue: null, newValue: null, text: '' }
    expect(detail.changeLog).toEqual([
      { ...empty, publishedAt: '2026-11-05', title: 'DELETE', field: 'Anhang' },
      { ...empty, publishedAt: '2026-11-05', title: 'ADD', field: 'Anhang' },
      { ...empty, publishedAt: '2026-11-05', title: 'UPDATE', field: 'Einlagezahl' },
      { ...empty, publishedAt: '2026-11-05', title: 'ADD', field: 'Beschreibung des Zubehörs' },
      { ...empty, publishedAt: '2026-11-05', title: 'UPDATE', field: 'Wert des Objekts' },
      { ...empty, publishedAt: '2026-11-03', title: 'DELETE', field: 'Beschreibung des Zubehörs' },
      { ...empty, publishedAt: '2026-11-03', title: 'ADD', field: 'Weitere Dokumente' },
      { ...empty, publishedAt: '2026-11-03', title: 'UPDATE', field: 'Adressdaten' },
    ])
    expectLeftOut('detail-rich.json', 990001, [
      'Gartenhütte',
      'Beispielgasse 2',
      'Erfundenweg 5',
      'Muster Immobilien GesmbH',
    ])
  })
})

describe('parseInsolvencyDetail on a sparse record', () => {
  const detail = parseInsolvencyDetail(readJsonFixture('detail-sparse.json'), 990003)

  // Catches "-" or an item without text stored as a value, and a lease shown as a sale.
  it('reads "-", an empty text and a missing text as null', () => {
    expect(detail).toMatchObject({
      court: 'LG Beispielstadt',
      caseNumber: '098 7 S 56/25 z',
      publishedAt: '2026-09-14',
      changedAt: null,
      transaction: 'lease',
      street: null,
      plz: '9998',
      city: 'Beispieldorf',
      bundesland: 'stmk',
      title: 'Landwirtschaftliche Fläche',
      description: null,
      categoryCodes: ['LF'],
      grundstuecksnr: null,
      blnr: null,
      grundstuecksgroesseSqm: null,
      objektgroesseSqm: null,
      objektgroesseRaw: null,
      valueEur: null,
      zubehoer: 'Kein Zubehör',
      link: null,
      facts: null,
      deputy: null,
      documents: [],
      skippedFiles: { deleted: 0, notPdf: 0, foreignUrl: 0, unreadable: 0 },
      changeLog: [],
      missing: [],
    })
    expect(detail.administrator?.fax).toBeNull()
    expect(Object.values(detail.rawLabels)).not.toContain('-')
    expect(Object.keys(detail.rawLabels)).not.toContain('Beschreibung')
  })
})

describe('the debtor of a notice', () => {
  // Catches the insolvent company reaching the database through a field, a raw label or the change log, also under a heading the API adds to the debtor's block ("UID-Nummer" stands for one).
  it('is left out of a record with a history', () => {
    expectLeftOut('detail-rich.json', 990001, [
      'Muster Immobilien',
      'FN 999999 z',
      'Erfundenweg',
      '9990 Fantasiedorf',
      'ATU99999999',
      '"UID-Nummer"',
      '"Name Schuldner:in"',
      '"Firmenbuchnummer"',
      '"Adresse"',
      '"PLZ, Ort"',
    ])
  })

  // Catches the same for a private debtor, whose notice has no company register number.
  it('is left out of a sparse record', () => {
    expectLeftOut('detail-sparse.json', 990003, [
      'Erna Erfunden',
      'Schuldnerweg 9',
      '9991 Schuldnerdorf',
      '"Name Schuldner:in"',
      '"Adresse"',
      '"PLZ, Ort"',
    ])
  })
})

describe('parseInsolvencyDetail', () => {
  // Catches the record of another number stored under the requested one, and an error page read as an empty record.
  it('reports another record number and a body that is no record as site_changed', () => {
    const published = readJsonFixture('detail-rich.json')
    expect(errorOf(() => parseInsolvencyDetail(published, 990002))).toMatchObject({
      code: 'site_changed',
    })
    for (const body of [null, [], {}, { edikt: { id: 990001 } }]) {
      expect(errorOf(() => parseInsolvencyDetail(body, 990001))).toMatchObject({
        code: 'site_changed',
      })
    }
  })

  // Catches an emptied record passing the health check, and an unknown transaction shown as a sale.
  it('names the parts a record lacks', () => {
    const detail = parseInsolvencyDetail(
      record([list('Grunddaten', { 'Art der Transaktion': 'Tausch' })]),
      990009,
    )
    expect(detail.missing).toEqual([
      'court',
      'caseNumber',
      'plz',
      'bundesland',
      'Adressdaten, Beschreibung und Schätzwert',
      'Insolvenzverwalter:in',
    ])
    expect(detail).toMatchObject({
      transactionText: 'Tausch',
      transaction: 'other',
      administrator: null,
    })
  })

  // Catches a report whose name mentions its annexes or photos filed as one of them, which leaves the record without a report to analyse, and a site plan filed as another document.
  it('decides the kind of a file by its section and the first keyword in its name', () => {
    const inReportSection = {
      Gutachten: 'langgutachten',
      'Gutachten samt Beilagen': 'langgutachten',
      'Gutachten mit Lichtbildern': 'langgutachten',
      'Verkehrswertgutachten samt Beilagen': 'langgutachten',
      'Bewertung der Liegenschaft': 'langgutachten',
      'Beilage zum Gutachten': 'other',
      'Anlage 1': 'other',
      'Fotos zum Gutachten': 'photo',
      Lichtbildbeilage: 'photo',
      Bilddokumentation: 'photo',
    }
    const inFurtherDocuments = {
      Lageplan: 'plan',
      Grundrissplan: 'plan',
      'Grundriss Obergeschoß': 'plan',
      Bauplan: 'plan',
      Einreichplan: 'plan',
      Bestandsplan: 'plan',
      Katasterplan: 'plan',
      Teilungsplan: 'plan',
      Übersichtsplan: 'plan',
      Sanierungsplan: 'other',
      Zahlungsplan: 'other',
      Energieausweis: 'other',
    }
    const detail = parseInsolvencyDetail(
      record([
        files('Gutachten / Texte', Object.keys(inReportSection)),
        files('Weitere Dokumente', Object.keys(inFurtherDocuments)),
      ]),
      990009,
    )
    expect(Object.fromEntries(detail.documents.map((file) => [file.title, file.kind]))).toEqual({
      ...inReportSection,
      ...inFurtherDocuments,
    })
  })
})

describe('record URLs', () => {
  // Catches a wrong path in the two URLs the app builds for a record, and a number that is none in a URL.
  it('builds the API URL and the public URL of a record', () => {
    expect(insolvencyDetailUrl(990001)).toBe(
      'https://justizonline.gv.at/jop/service/edi/v1/edikte/990001',
    )
    expect(insolvencyPublicUrl(990001)).toBe(
      'https://justizonline.gv.at/jop/web/ediktsdatei/suche/990001',
    )
    expect(() => insolvencyDetailUrl(1.5)).toThrow()
    expect(() => insolvencyPublicUrl(-1)).toThrow()
  })
})

describe('insolvencyFileUrl', () => {
  const published = 'service/edi/v1/edikte/990001/resources/TVZfOTkwMDAxX0-_Zg=='

  // Catches a file URL resolved against the wrong folder, and a base64 character the token rule refuses.
  it('resolves a file of the record', () => {
    expect(insolvencyFileUrl(published, 990001)).toBe(`https://justizonline.gv.at/jop/${published}`)
  })

  // Catches a response that points a download at another host or at another record.
  it.each([
    ['another host', `https://example.org/jop/${published}`],
    ['another host without a scheme', `//example.org/jop/${published}`],
    ['another record number', 'service/edi/v1/edikte/990002/resources/TVZfOTkwMDAx'],
    ['a query string', `${published}?download=1`],
    ['a fragment', `${published}#page=2`],
    ['a second path segment', `${published}/extra`],
    [
      '".." that ends at the record',
      'service/edi/v1/edikte/990002/../990001/resources/TVZfOTkwMDAx',
    ],
    ['".." that leaves the API', '../../etc/passwd'],
    [
      'an escaped ".." in the last segment',
      'service/edi/v1/edikte/990001/resources/..%2F..%2F990002%2Fresources%2FTVZfOTkwMDAx',
    ],
  ])('refuses %s', (_case, fileUrl) => {
    expect(insolvencyFileUrl(fileUrl, 990001)).toBeNull()
  })
})
