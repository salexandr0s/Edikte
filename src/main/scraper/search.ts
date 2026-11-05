import { load } from 'cheerio'
import { z } from 'zod'
import { LocalDateSchema } from '@shared/domain'
import {
  BUNDESLAND_SITE_CODES,
  CATEGORIES,
  EDIKTE_ORIGIN,
  EX_DB_PATH,
  noticeTypeForText,
  type CategoryCode,
} from '@shared/edikte-codes'
import { BundeslandSchema, NoticeTypeSchema, type Bundesland } from '@shared/enums'
import { AppError, isAppError } from '@shared/errors'
import { exceedsShare } from './health'
import {
  EDICT_ID_PATTERN,
  categoryCodesFor,
  detailUrl,
  edictIdFromHref,
  normalizeSpace,
  parseSiteDates,
  textAtBreaks,
  type Elements,
} from './site-text'

/** Most rows the site returns for one search. */
export const SEARCH_MAX = 4999

const CATEGORY_CODES = Object.keys(CATEGORIES) as [CategoryCode, ...CategoryCode[]]

export const SearchFilterSchema = z.object({
  bundesland: BundeslandSchema,
  categories: z.array(z.enum(CATEGORY_CODES)).optional(),
  /** Upper limit for the Schätzwert in euros. */
  maxValueEur: z.number().int().nonnegative().optional(),
  /** Only edicts published on or after this Vienna date ("YYYY-MM-DD"). */
  publishedSince: LocalDateSchema.optional(),
})
export type SearchFilter = z.infer<typeof SearchFilterSchema>

/** Domino query for the site's search view; clauses are joined with AND. */
export function buildSearchQuery(filter: SearchFilter): string {
  const {
    bundesland,
    categories = [],
    maxValueEur,
    publishedSince,
  } = SearchFilterSchema.parse(filter)
  const clauses = [`([BL]=(${BUNDESLAND_SITE_CODES[bundesland]}))`]
  if (categories.length > 0) {
    clauses.push(`(${categories.map((code) => `[VKat]=(${code})`).join(' | ')})`)
  }
  if (maxValueEur !== undefined) clauses.push(`([NumVWert]<=${maxValueEur})`)
  if (publishedSince !== undefined) {
    const [, year = '', month = '', day = ''] =
      /^(\d{4})-(\d{2})-(\d{2})$/.exec(publishedSince) ?? []
    clauses.push(`([DATBM]>=${day}.${month}.${year})`)
  }
  return clauses.join(' AND ')
}

/** Search URL as the site's own form builds it, with every match on one page. */
export function buildSearchUrl(filter: SearchFilter): string {
  const query = encodeURIComponent(buildSearchQuery(filter))
  return `${EDIKTE_ORIGIN}${EX_DB_PATH}/suchedi?SearchView&subf=eex&SearchOrder=4&SearchMax=${SEARCH_MAX}&retfields=&ftquery=&query=${query}`
}

export const SearchRowSchema = z.object({
  id: z.string().regex(EDICT_ID_PATTERN),
  url: z.string(),
  noticeType: NoticeTypeSchema,
  /** Link text as published, such as "Verschiebung (von 17.12.2026 auf 14.12.2026)". */
  noticeText: z.string().min(1),
  /** Date of the auction or hearing the notice is about; Zuschlag rows have none. */
  eventDate: LocalDateSchema.nullable(),
  /** Earlier date of a postponed auction. */
  previousDate: LocalDateSchema.nullable(),
  plz: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  city: z.string().nullable(),
  street: z.string().nullable(),
  /** Address line as published. */
  addressText: z.string(),
  categoryLabel: z.string().nullable(),
  categoryCodes: z.array(z.string()),
  /** Object description, such as "Wohnung W 1+2". */
  title: z.string().nullable(),
  bundesland: BundeslandSchema.nullable(),
})
export type SearchRow = z.infer<typeof SearchRowSchema>

export interface SearchResult {
  rows: SearchRow[]
  /** Matches the site reports; more than the rows read and skipped means the list was cut off. */
  totalHits: number
  /** Why each unreadable row was left out. */
  skipped: string[]
}

/** Domino's page for a search without matches. */
const NO_DOCUMENTS = /No documents found|Keine Dokumente gefunden/i
/** Share of rows that may be unreadable before the page counts as changed. */
const UNREADABLE_ROW_LIMIT = 0.2

/**
 * Reads the result table of a search page. Each row is read on its own, so a
 * row without a postcode never takes one from the row above. An unreadable
 * row is skipped; many of them mean the layout changed.
 */
export function parseSearchResults(
  html: string,
  bundesland: Bundesland | null = null,
): SearchResult {
  const $ = load(html)
  const hits = readCount($('input[name="Hits"][value]').first().attr('value'))
  if (hits === null) {
    if (NO_DOCUMENTS.test($('body').text())) return { rows: [], totalHits: 0, skipped: [] }
    throw new AppError('site_changed', 'The search page has no hit count')
  }
  const totalHits = readCount($('input[name="TotalHits"][value]').first().attr('value')) ?? hits
  // A page without hits may still show a placeholder row.
  if (hits === 0) return { rows: [], totalHits, skipped: [] }
  const tableRows = $('table tbody tr')
    .filter((_, row) => $(row).children('td').length > 0)
    .toArray()
  if (tableRows.length !== hits) {
    throw new AppError(
      'site_changed',
      `The search page lists ${tableRows.length} rows but reports ${hits}`,
    )
  }
  const rows: SearchRow[] = []
  const skipped: string[] = []
  for (const [index, row] of tableRows.entries()) {
    try {
      rows.push(parseRow($(row), index, bundesland))
    } catch (error) {
      if (!isAppError(error)) throw error
      skipped.push(error.message)
    }
  }
  if (exceedsShare(skipped.length, tableRows.length, UNREADABLE_ROW_LIMIT)) {
    throw new AppError(
      'site_changed',
      `${skipped.length} of ${tableRows.length} search result rows could not be read`,
    )
  }
  return { rows, totalHits, skipped }
}

function readCount(value: string | undefined): number | null {
  const text = value?.trim() ?? ''
  return /^\d+$/.test(text) ? Number(text) : null
}

function parseRow(row: Elements, index: number, bundesland: Bundesland | null): SearchRow {
  const cells = row.children('td')
  const link = cells.eq(1).find('a[href]').first()
  const id = edictIdFromHref(link.attr('href'))
  if (cells.length < 4 || id === null) {
    throw new AppError('site_changed', `Search result row ${index + 1} has an unknown layout`)
  }
  const noticeText = normalizeSpace(link.text())
  const dates = parseSiteDates(noticeText)
  const postponed = dates.length >= 2 && /\bvon\b.+\bauf\b/i.test(noticeText)
  const [addressText = '', ...categoryParts] = textAtBreaks(cells.eq(2))
  const categoryLabel = categoryParts.filter((part) => part !== '').join(', ')
  const title = normalizeSpace(cells.eq(3).text())
  const parsed = SearchRowSchema.safeParse({
    id,
    url: detailUrl(id),
    noticeType: noticeTypeForText(noticeText),
    noticeText,
    eventDate: (postponed ? dates[1] : dates[0]) ?? null,
    previousDate: postponed ? (dates[0] ?? null) : null,
    ...splitPlace(addressText),
    addressText,
    categoryLabel: categoryLabel === '' ? null : categoryLabel,
    categoryCodes: categoryCodesFor(categoryLabel),
    title: title === '' ? null : title,
    bundesland,
  })
  if (!parsed.success) {
    throw new AppError('site_changed', `Search result row ${index + 1} could not be read`)
  }
  return parsed.data
}

export interface Place {
  plz: string | null
  city: string | null
  street: string | null
}

// A street name can span several words: a generic word such as "Straße"
// belongs to the word before it ("Grazer Straße"), and a prefix such as "Am"
// to the word after it ("Am Kanal").
const STREET_WORDS = new Set([
  'straße',
  'strasse',
  'gasse',
  'weg',
  'platz',
  'allee',
  'ring',
  'zeile',
  'gürtel',
  'kai',
  'lände',
  'steig',
  'promenade',
  'siedlung',
  'graben',
  'ufer',
  'anger',
])
const STREET_PREFIXES = new Set([
  'Am',
  'An',
  'Auf',
  'Im',
  'In',
  'Zum',
  'Zur',
  'Untere',
  'Unterer',
  'Obere',
  'Oberer',
  'Alte',
  'Alter',
  'Neue',
  'Neuer',
  'Kleine',
  'Große',
  'Hohe',
  'Lange',
  'Innere',
  'Äußere',
  'Hintere',
  'Vordere',
  'Dr.',
  'Prof.',
  'St.',
  'Sankt',
])
const STREET_SUFFIX = new RegExp(`(?:${[...STREET_WORDS].join('|')})$`, 'i')

/**
 * Splits a list address such as "8354 St. Anna am Aigen Hügelweg 34" into
 * postcode, place and street. Vienna is exact; elsewhere the street starts at
 * the word before the first house number. Edict pages carry these fields
 * separately, so this only fills in until the page has been read.
 */
export function splitPlace(text: string): Place {
  const normalized = normalizeSpace(text)
  const match = /^(\d{4})(?:\s+|$)(.*)$/.exec(normalized)
  const rest = match === null ? normalized : (match[2] ?? '')
  return { plz: match?.[1] ?? null, ...splitCityStreet(rest) }
}

function splitCityStreet(text: string): Omit<Place, 'plz'> {
  if (text === '') return { city: null, street: null }
  if (text === 'Wien' || text.startsWith('Wien ')) {
    const street = text.slice('Wien'.length).trim()
    return { city: 'Wien', street: street === '' ? null : street }
  }
  const words = text.split(' ')
  const numberAt = words.findIndex((word, index) => index > 0 && /^\d/.test(word))
  let streetAt =
    numberAt === -1
      ? words.findIndex((word, index) => index > 0 && STREET_SUFFIX.test(word))
      : numberAt - 1
  if (streetAt === -1) return { city: text, street: null }
  // A village address such as "Auerbach 12" has no street name.
  if (streetAt === 0) return { city: words[0] ?? null, street: text }
  while (
    streetAt > 1 &&
    (STREET_WORDS.has((words[streetAt] ?? '').toLowerCase()) ||
      STREET_PREFIXES.has(words[streetAt - 1] ?? ''))
  ) {
    streetAt -= 1
  }
  return { city: words.slice(0, streetAt).join(' '), street: words.slice(streetAt).join(' ') }
}
