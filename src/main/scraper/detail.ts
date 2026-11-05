import { load, type CheerioAPI } from 'cheerio'
import { z } from 'zod'
import { LocalDateSchema, LocalDateTimeSchema } from '@shared/domain'
import { noticeTypeForText } from '@shared/edikte-codes'
import { DocumentKindSchema, type DocumentKind, type NoticeType } from '@shared/enums'
import { AppError } from '@shared/errors'
import { computeContentHash } from './content-hash'
import {
  categoryCodesFor,
  edictIdFromHref,
  extractEur,
  extractSqm,
  isUnavailable,
  labelKey,
  labelLookup,
  normalizeSpace,
  parseSiteDate,
  parseSiteDateTime,
  rawLabelMap,
  readPageRows,
  siteUrl,
  type Elements,
  type LabelRow,
} from './site-text'

/** Typed values read from the labels of an edict page. */
export const DetailFieldsSchema = z.object({
  /** Court name without its code, such as "BG Leopoldstadt". */
  court: z.string().min(1).nullable(),
  courtCode: z.string().regex(/^\d+$/).nullable(),
  caseNumber: z.string().min(1).nullable(),
  publishedAt: LocalDateSchema.nullable(),
  changedAt: LocalDateSchema.nullable(),
  /** Auction date: the current one, the new one after a postponement, or the cancelled one. */
  auctionAt: LocalDateTimeSchema.nullable(),
  auctionPlace: z.string().nullable(),
  viewing: z.string().nullable(),
  grundbuch: z.string().nullable(),
  ez: z.string().nullable(),
  street: z.string().nullable(),
  plz: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  city: z.string().nullable(),
  categoryLabel: z.string().nullable(),
  categoryCodes: z.array(z.string()),
  grundstuecksgroesseSqm: z.number().positive().nullable(),
  objektgroesseSqm: z.number().positive().nullable(),
  objektgroesseRaw: z.string().nullable(),
  schaetzwertEur: z.number().nonnegative().nullable(),
  geringstesGebotEur: z.number().nonnegative().nullable(),
  vadiumEur: z.number().nonnegative().nullable(),
  meistbotEur: z.number().nonnegative().nullable(),
  zubehoer: z.string().nullable(),
  remarks: z.string().nullable(),
})
export type DetailFields = z.infer<typeof DetailFieldsSchema>

export const DocumentLinkSchema = z.object({
  kind: DocumentKindSchema,
  title: z.string().min(1),
  fileName: z.string().min(1),
  url: z.string(),
  /** Size the link text states, such as 7360 for "(7360 KB)". */
  statedSizeKb: z.number().int().nonnegative().nullable(),
})
export type DocumentLink = z.infer<typeof DocumentLinkSchema>

/** One change from the log at the end of an edict page. */
export interface ChangeLogEntry {
  publishedAt: string | null
  /** "Sonstiges Edikt", "Verschiebung" or "Entfall des Termins". */
  title: string
  /** Changed field, such as "Geringstes Gebot"; null for a postponement or cancellation. */
  field: string | null
  oldValue: string | null
  newValue: string | null
  /** Text of the whole log entry. */
  text: string
}

/** One line of "Alle Edikte zum Fall". */
export interface ChainEntry {
  /** Null for the page itself, which the site lists without a link. */
  id: string | null
  noticeType: NoticeType
  text: string
  eventAt: string | null
  address: string | null
}

export interface ParsedDetail {
  /** From the bookmark link; null when the page has none. */
  id: string | null
  noticeType: NoticeType
  /** Heading before the object, such as "Versteigerung". */
  noticeText: string
  /** Heading after " - ", such as "Wohnung Stiege 1 Top 25". */
  objectTitle: string | null
  /** The page shows the "Berichtigte Fassung" banner. */
  corrected: boolean
  rawLabels: Record<string, string>
  fields: DetailFields
  changeLog: ChangeLogEntry[]
  related: ChainEntry[]
  documents: DocumentLink[]
  /** HTML page with the Kurzgutachten facts. */
  kurzgutachtenUrl: string | null
  /** Hash of the content area; an equal hash means the page did not change. */
  contentHash: string
}

const NOT_FOUND = /Dokument wurde nicht gefunden|Document has been deleted/i

/** Parses an edict page (`alldoc/<id>!OpenDocument`). */
export function parseDetailPage(html: string): ParsedDetail {
  const $ = load(html)
  const root = $('#druckbereich').first()
  if (root.length === 0) {
    if (NOT_FOUND.test(`${$('title').text()} ${$('body').text()}`)) {
      throw new AppError('not_found', 'The edict page no longer exists')
    }
    throw new AppError('site_changed', 'The edict page has no content area')
  }
  const heading = normalizeSpace(root.find('h1').first().text())
  const separator = heading.indexOf(' - ')
  const noticeText = separator === -1 ? heading : heading.slice(0, separator)
  const objectTitle = separator === -1 ? '' : heading.slice(separator + 3).trim()
  const { fields: rows, chain } = readPageRows($, root)
  const rawLabels = rawLabelMap($, rows)
  return {
    id: edictIdFromHref($('#ajax_link a[href]').first().attr('href')),
    noticeType: noticeTypeForText(noticeText),
    noticeText,
    objectTitle: objectTitle === '' ? null : objectTitle,
    corrected: root
      .find('div.well')
      .toArray()
      .some((element) => /Berichtigte Fassung/i.test($(element).text())),
    rawLabels,
    fields: readFields($, root, rawLabels),
    changeLog: readChangeLog($, root),
    related: chain.map((row) => readChainEntry(row)),
    documents: readDocuments($, rows),
    kurzgutachtenUrl: readKurzgutachtenUrl($, rows),
    contentHash: computeContentHash(normalizeSpace(root.html() ?? '')),
  }
}

function readFields(
  $: CheerioAPI,
  root: Elements,
  rawLabels: Readonly<Record<string, string>>,
): DetailFields {
  const lookup = labelLookup(rawLabels)
  const value = (...labels: string[]): string | null => {
    const found = lookup(...labels)
    return found === null || isUnavailable(found) ? null : found
  }
  const court = splitCourt(firstLine(value('Dienststelle')))
  // "Adresse" is the street on most pages but "PLZ Ort" on written-bid notices.
  const address = value('Adresse')
  const addressIsPlace = address !== null && /^\d{4}(?:\s|$)/.test(address)
  const placeText = firstLine(value('PLZ/Ort') ?? (addressIsPlace ? address : null))
  const place = placeText === null ? null : /^(\d{4})\s*(.*)$/.exec(placeText)
  const landRegister = readLandRegister(rawLabels)
  const categoryLabel = joinLines(value('Kategorie(n)', 'Kategorie'), ', ')
  const zubehoer = [
    value('Beschreibung des mitzuversteigernden Zubehörs'),
    value('Wert des mitzuversteigernden Zubehörs'),
  ].filter((part): part is string => part !== null)
  const candidate: DetailFields = {
    court: court.name,
    courtCode: court.code,
    caseNumber: firstLine(value('Aktenzeichen')),
    publishedAt: mapValue(value('Bekannt gemacht am'), parseSiteDate),
    changedAt: mapValue(value('Letzte Änderung am'), parseSiteDate),
    auctionAt: mapValue(
      value('Versteigerungstermin', 'Neuer Versteigerungstermin', 'Termin'),
      parseSiteDateTime,
    ),
    auctionPlace: value('Versteigerungsort', 'Neuer Ort', 'Ort'),
    viewing: value('Besichtigungszeit', 'Ort und Zeit der Besichtigung', 'Besichtigung'),
    grundbuch: firstLine(value('Grundbuch')) ?? landRegister.grundbuch,
    ez: firstLine(value('EZ', 'Einlagezahl')) ?? landRegister.ez,
    street: joinLines(value('Liegenschaftsadresse') ?? (addressIsPlace ? null : address), ', '),
    plz: place?.[1] ?? null,
    city: emptyToNull(place?.[2]),
    categoryLabel,
    categoryCodes: categoryCodesFor(categoryLabel),
    grundstuecksgroesseSqm: mapValue(value('Grundstücksgröße'), extractSqm),
    objektgroesseSqm: mapValue(value('Objektgröße'), extractSqm),
    objektgroesseRaw: firstLine(value('Objektgröße')),
    schaetzwertEur: mapValue(value('Schätzwert'), extractEur),
    geringstesGebotEur: mapValue(value('Geringstes Gebot'), extractEur),
    vadiumEur: mapValue(value('Vadium'), extractEur),
    meistbotEur: mapValue(value('Meistbot'), extractEur) ?? meistbotFromText($, root),
    zubehoer: zubehoer.length === 0 ? null : zubehoer.join('\n'),
    remarks: value('Sonstige Hinweise'),
  }
  const parsed = DetailFieldsSchema.safeParse(candidate)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new AppError('site_changed', `Unexpected values on the edict page: ${fields}`)
  }
  return parsed.data
}

function mapValue<T>(text: string | null, parse: (text: string) => T | null): T | null {
  return text === null ? null : parse(text)
}

function firstLine(text: string | null): string | null {
  return emptyToNull(text?.split('\n')[0])
}

function joinLines(text: string | null, separator: string): string | null {
  return text === null ? null : text.split('\n').join(separator)
}

function emptyToNull(text: string | undefined): string | null {
  return text === undefined || text === '' ? null : text
}

function splitCourt(text: string | null): { name: string | null; code: string | null } {
  const match = text === null ? null : /^(.*?)\s*\((\d*)\)$/.exec(text)
  if (match === null) return { name: text, code: null }
  return { name: emptyToNull(match[1]), code: emptyToNull(match[2]) }
}

/** Zuschlag pages state the land register as "01009 Mariahilf EZ 908" below "Die Liegenschaft(en) Grundbuch". */
function readLandRegister(rawLabels: Readonly<Record<string, string>>): {
  grundbuch: string | null
  ez: string | null
} {
  for (const [label, text] of Object.entries(rawLabels)) {
    const key = labelKey(label)
    if (key === 'grundbuch' || !key.endsWith('grundbuch')) continue
    const match = /^(.*?)\s+EZ\s+(\S+)/.exec(text.split('\n')[0] ?? '')
    if (match !== null) return { grundbuch: emptyToNull(match[1]), ez: emptyToNull(match[2]) }
  }
  return { grundbuch: null, ez: null }
}

/**
 * Zuschlag pages give the winning bid in a sentence: "um das Meistbot von
 * 292.000,00 EUR" or "Meistbot von EUR 440.000,00".
 */
function meistbotFromText($: CheerioAPI, root: Elements): number | null {
  for (const element of root.children('p').toArray()) {
    const match = /Meistbot(?:es)?\s+von\s+(?:(?:EUR|€)\s*)?(\d[\d.,']*\d|\d)/i.exec(
      normalizeSpace($(element).text()),
    )
    const amount = match?.[1] === undefined ? null : extractEur(match[1])
    if (amount !== null) return amount
  }
  return null
}

function readChangeLog($: CheerioAPI, root: Elements): ChangeLogEntry[] {
  const entries: ChangeLogEntry[] = []
  for (const element of root.find('div.edibody p.edititle').toArray()) {
    const heading = $(element)
    const publishedAt = parseSiteDate(heading.prevAll('p.edibekannt').first().text())
    const title = normalizeSpace(heading.text())
    const texts = heading.nextUntil('p.edititle, p.edibekannt').filter('p.editext').toArray()
    if (texts.length === 0) {
      entries.push({ publishedAt, title, field: null, oldValue: null, newValue: null, text: '' })
    }
    for (const text of texts) entries.push(...readChanges($, $(text), publishedAt, title))
  }
  return entries
}

/** One entry per changed field; the field name is the quoted span before the values. */
function readChanges(
  $: CheerioAPI,
  paragraph: Elements,
  publishedAt: string | null,
  title: string,
): ChangeLogEntry[] {
  const text = normalizeSpace(paragraph.text())
  const changes: ChangeLogEntry[] = []
  const start = (field: string | null): ChangeLogEntry => {
    const change: ChangeLogEntry = {
      publishedAt,
      title,
      field,
      oldValue: null,
      newValue: null,
      text,
    }
    changes.push(change)
    return change
  }
  let current: ChangeLogEntry | null = null
  for (const element of paragraph.find('span').toArray()) {
    const span = $(element)
    const spanText = normalizeSpace(span.text())
    const isOld = span.hasClass('todoldval')
    if (!isOld && !span.hasClass('todnewval')) {
      current = start(emptyToNull(spanText.replace(/^["„“”]+|["„“”]+$/g, '')))
      continue
    }
    if (current === null || (isOld ? current.oldValue : current.newValue) !== null) {
      current = start(current?.field ?? null)
    }
    if (isOld) current.oldValue = spanText
    else current.newValue = spanText
  }
  return changes.length > 0 ? changes : [start(null)]
}

function readChainEntry(row: Elements): ChainEntry {
  const label = row.children('span').first()
  const text = normalizeSpace(label.text())
  const link = label.find('a[href]').first()
  const address = normalizeSpace(row.children('p').first().text())
  return {
    id: link.length === 0 ? null : edictIdFromHref(link.attr('href')),
    noticeType: noticeTypeForText(text),
    text,
    eventAt: parseSiteDateTime(text),
    address: address === '' ? null : address,
  }
}

const KIND_BY_LABEL: ReadonlyArray<readonly [RegExp, DocumentKind]> = [
  [/^kurzgutachten/i, 'kurzgutachten'],
  [/^langgutachten/i, 'langgutachten'],
  [/^(?:lageplan|grundriss)/i, 'plan'],
  [/^foto/i, 'photo'],
]
const ANNEX_TITLE = /^(?:beilagen?|anlagen?|anhang|anhänge)(?![a-zäöüß])/i
const SIZE_SUFFIX = /\s*\((\d+)\s*KB\)\s*$/i
const FORMAT_SUFFIX = /\s*\((?:pdf|jpe?g|png|tiff?|docx?)\)\s*$/i

/** Downloadable files (`/$file/` links) in the upload rows, without duplicates. */
function readDocuments($: CheerioAPI, rows: readonly LabelRow[]): DocumentLink[] {
  const found = new Map<string, DocumentLink>()
  for (const { label, cell } of rows) {
    const rowKind = KIND_BY_LABEL.find(([pattern]) => pattern.test(label))?.[1] ?? 'other'
    for (const element of cell.find('a[href]').toArray()) {
      const link = $(element)
      const url = siteUrl(link.attr('href') ?? '')
      if (url === null || !url.includes('/$file/') || found.has(url)) continue
      const described = linkTitle(link)
      const size = SIZE_SUFFIX.exec(described)?.[1]
      const title = described.replace(SIZE_SUFFIX, '').replace(FORMAT_SUFFIX, '')
      const fileName = fileNameOf(url)
      // A lease or an annex such as "Beilagen zum Langgutachten" can share the report rows.
      const extra =
        ANNEX_TITLE.test(title) || (rowKind === 'langgutachten' && !/gutachten/i.test(title))
      const kind =
        extra && (rowKind === 'langgutachten' || rowKind === 'kurzgutachten') ? 'other' : rowKind
      const parsed = DocumentLinkSchema.safeParse({
        kind,
        title: title === '' ? fileName : title,
        fileName,
        url,
        statedSizeKb: size === undefined ? null : Number(size),
      })
      if (parsed.success) found.set(url, parsed.data)
    }
  }
  return [...found.values()]
}

function linkTitle(link: Elements): string {
  const text = normalizeSpace(link.text())
  if (text !== '') return text
  const alt = normalizeSpace(link.find('img').first().attr('alt') ?? '')
  if (alt !== '') return alt
  return normalizeSpace((link.attr('title') ?? '').replace(/\(neues Fenster\)/i, ''))
}

function fileNameOf(url: string): string {
  const last = new URL(url).pathname.split('/').pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

function readKurzgutachtenUrl($: CheerioAPI, rows: readonly LabelRow[]): string | null {
  for (const { label, cell } of rows) {
    if (!/^kurzgutachten/i.test(label)) continue
    for (const element of cell.find('a[href]').toArray()) {
      const url = siteUrl($(element).attr('href') ?? '')
      if (url !== null && !url.includes('/$file/')) return url
    }
  }
  return null
}
