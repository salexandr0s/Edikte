import type { Cheerio, CheerioAPI } from 'cheerio'
import {
  EDIKTE_HOST,
  EDIKTE_ORIGIN,
  EX_DB_PATH,
  categoryCodeForLabel,
  type CategoryCode,
} from '@shared/edikte-codes'
import { findSqmMentions, parseEur, parseSqm } from '@shared/parse-numbers'

// Helpers shared by the list, detail and Kurzgutachten parsers. Pages are read
// through cheerio; regular expressions only ever see extracted text.

/**
 * Elements as cheerio's `find` returns them. Taken from cheerio's own types
 * because domhandler, which defines `Element`, is not a direct dependency.
 */
export type Elements = ReturnType<Cheerio<never>['find']>

/** Edict IDs are the site's 32-hex Domino document IDs, stored lowercase. */
export const EDICT_ID_PATTERN = /^[0-9a-f]{32}$/

const DB_BASE = `${EDIKTE_ORIGIN}${EX_DB_PATH}/`

/** Canonical URL of an edict page. */
export function detailUrl(id: string): string {
  return `${DB_BASE}alldoc/${id}!OpenDocument`
}

/** Resolves a link found on a site page; null when it is empty or leaves the Edikte host. */
export function siteUrl(href: string): string | null {
  if (href.trim() === '') return null
  try {
    const url = new URL(href, DB_BASE)
    return url.protocol === 'https:' && url.host === EDIKTE_HOST ? url.toString() : null
  } catch {
    return null
  }
}

/** Reads the edict ID from links such as "alldoc/<id>!OpenDocument" or "/0/<id>". */
export function edictIdFromHref(href: string | undefined): string | null {
  if (href === undefined) return null
  const match = /(?:^|\/)(?:alldoc|0)\/([0-9a-f]{32})(?=$|[!/?#])/i.exec(href)
  return match?.[1]?.toLowerCase() ?? null
}

/** Collapses whitespace, including the no-break spaces the site puts before units. */
export function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Comparable form of a label: no trailing colon, lowercase, umlauts spelled out. */
export function labelKey(label: string): string {
  return normalizeSpace(label.normalize('NFC'))
    .replace(/\s*:$/, '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

const UNAVAILABLE = /^(?:nicht verfügbar|-+)$/i

/** True for values the site uses to say a field is empty. */
export function isUnavailable(value: string): boolean {
  return value === '' || UNAVAILABLE.test(value)
}

// Private-use character that stands for <br> while text is extracted. Line
// breaks in the HTML source are plain whitespace and must not split lines.
const LINE_BREAK = ''

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Text of an element split at its <br> elements; empty parts are kept. */
export function textAtBreaks(element: Elements): string[] {
  const copy = element.clone()
  copy.find('br').replaceWith(LINE_BREAK)
  return copy.text().split(LINE_BREAK).map(normalizeSpace)
}

/**
 * Text of a value cell, one line per <br>, link or paragraph. Images count by
 * their alt text. Empty lines are dropped.
 */
function cellText($: CheerioAPI, cell: Elements): string {
  const copy = cell.clone()
  copy.find('script, style').remove()
  copy.find('img').each((_, image) => {
    $(image).replaceWith(escapeText($(image).attr('alt') ?? ''))
  })
  copy.find('br').replaceWith(LINE_BREAK)
  copy.find('a, p, div, li').after(LINE_BREAK)
  return copy
    .text()
    .split(LINE_BREAK)
    .map(normalizeSpace)
    .filter((line) => line !== '')
    .join('\n')
}

export interface LabelRow {
  /** Label as published, without the trailing colon. */
  label: string
  cell: Elements
}

export interface PageRows {
  fields: LabelRow[]
  /** Rows below "Alle Edikte zum Fall", one per edict of the case. */
  chain: Elements[]
}

const CHAIN_MARKER = /Alle Edikte zum Fall/i

/** Splits the `div.row` elements of a page into label rows and case-chain rows. */
export function readPageRows($: CheerioAPI, root: Elements): PageRows {
  const marker = root
    .find('p')
    .filter((_, paragraph) => CHAIN_MARKER.test($(paragraph).text()))
    .first()
  const chainRows = new Set(marker.nextAll('div.row').toArray())
  const fields: LabelRow[] = []
  const chain: Elements[] = []
  for (const element of root.find('div.row').toArray()) {
    const row = $(element)
    if (chainRows.has(element)) {
      chain.push(row)
      continue
    }
    let label = normalizeSpace(row.children('span').first().text()).replace(/\s*:$/, '')
    if (label === '') {
      // Zuschlag pages put the land register line below a plain paragraph.
      const previous = normalizeSpace(row.prev('p').text())
      if (previous === '' || previous.length > 60) continue
      label = previous.replace(/\s*:$/, '')
    }
    fields.push({ label, cell: row.children('p').first() })
  }
  return { fields, chain }
}

/** Label/value map as published; a repeated label keeps every value, one per line. */
export function rawLabelMap($: CheerioAPI, rows: readonly LabelRow[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const { label, cell } of rows) {
    const value = cellText($, cell)
    const existing = map[label]
    map[label] = existing === undefined || existing === '' ? value : `${existing}\n${value}`
  }
  return map
}

/** Returns a lookup that finds the first of several labels, compared by `labelKey`. */
export function labelLookup(
  map: Readonly<Record<string, string>>,
): (...labels: string[]) => string | null {
  const byKey = new Map(Object.entries(map).map(([label, value]) => [labelKey(label), value]))
  return (...labels) => {
    for (const label of labels) {
      const value = byKey.get(labelKey(label))
      if (value !== undefined) return value
    }
    return null
  }
}

const DATE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/
// "um 10:00", ", 10:00" or ", 9.00" right after the date. Minutes followed by
// ".2026" belong to another date, as in "03.12.2026, 10.12.2026".
const TIME_AFTER_DATE = /^\s*,?\s*(?:um\s+)?(\d{1,2})[:.](\d{2})(?!\d|[.:]\d)/

function toLocalDate(day: string, month: string, year: string): string | null {
  const d = Number(day)
  const m = Number(month)
  const y = Number(year)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null
  }
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** First date in a text, as Vienna local "YYYY-MM-DD": "25.2.2026" gives "2026-02-25". */
export function parseSiteDate(text: string): string | null {
  const match = DATE.exec(text)
  if (match === null) return null
  const [, day = '', month = '', year = ''] = match
  return toLocalDate(day, month, year)
}

/**
 * First date with a time right after it, as Vienna local "YYYY-MM-DDTHH:mm":
 * "am 03.12.2026 um 10:00 Uhr" gives "2026-12-03T10:00". Never converted to UTC.
 */
export function parseSiteDateTime(text: string): string | null {
  const match = DATE.exec(text)
  if (match === null) return null
  const [whole, day = '', month = '', year = ''] = match
  const date = toLocalDate(day, month, year)
  const time = TIME_AFTER_DATE.exec(text.slice(match.index + whole.length))
  if (date === null || time === null) return null
  const [, hour = '', minute = ''] = time
  if (Number(hour) > 23 || Number(minute) > 59) return null
  return `${date}T${hour.padStart(2, '0')}:${minute}`
}

/** Every date in a text, in order. */
export function parseSiteDates(text: string): string[] {
  return [...text.matchAll(new RegExp(DATE.source, 'g'))]
    .map((match) => parseSiteDate(match[0]))
    .filter((date): date is string => date !== null)
}

/** Category codes for a label list such as "Eigentumswohnung, Maisonette"; unknown labels are left out. */
export function categoryCodesFor(label: string | null): CategoryCode[] {
  if (label === null) return []
  const codes = label
    .split(/\s*[,\n]\s*/)
    .map((part) => categoryCodeForLabel(part))
    .filter((code): code is CategoryCode => code !== null)
  return [...new Set(codes)]
}

const MONEY_NEAR_CURRENCY = /(?:EUR|€)\s*(\d[\d.,']*\d|\d)|(\d[\d.,']*\d|\d)\s*(?:EUR|€)/i

/** Euro amount of a value such as "382.000,00 EUR", or the first amount in a sentence. */
export function extractEur(text: string): number | null {
  const direct = parseEur(text.split('\n')[0] ?? '')
  if (direct !== null) return direct
  const match = MONEY_NEAR_CURRENCY.exec(text)
  const amount = match?.[1] ?? match?.[2]
  return amount === undefined ? null : parseEur(amount)
}

/** Area of a value such as "85,22 m²", or the first area mentioned in it. */
export function extractSqm(text: string): number | null {
  return parseSqm(text.split('\n')[0] ?? '') ?? findSqmMentions(text)[0]?.sqm ?? null
}
