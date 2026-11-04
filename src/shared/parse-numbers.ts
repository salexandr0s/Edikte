/**
 * Number parsing for Austrian court notices and appraisals, which use German
 * formatting: "1.234,56" is 1234.56 and "3.353" is 3353.
 *
 * Replaces immoradar's parseEurPrice and parseSqm. Those matched "vb" and "n.a."
 * anywhere in a string and read "3.353 m²" as 3.35.
 */

// \s also matches the no-break spaces used as thousands separators (U+00A0, U+2007, U+202F).
const IGNORED_SPACES = /[\s']/g
const NUMBER_CHARS = /^[+-]?[\d.,]+$/

/**
 * Parses a bare number written in German or English notation.
 * Returns null for anything that is not a single well-formed number.
 */
export function parseGermanNumber(raw: string): number | null {
  const text = raw.replace(IGNORED_SPACES, '').replace(/[.,]-{1,2}$/, '')
  if (text === '' || !NUMBER_CHARS.test(text)) return null

  const negative = text.startsWith('-')
  const body = text.replace(/^[+-]/, '')
  const lastComma = body.lastIndexOf(',')
  const lastDot = body.lastIndexOf('.')

  let integerPart: string
  let fractionPart = ''

  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the later one is the decimal separator.
    const decimalAt = Math.max(lastComma, lastDot)
    const thousands = decimalAt === lastComma ? '.' : ','
    integerPart = body.slice(0, decimalAt)
    fractionPart = body.slice(decimalAt + 1)
    if (integerPart.includes(decimalAt === lastComma ? ',' : '.')) return null
    if (!hasValidGrouping(integerPart, thousands)) return null
    integerPart = integerPart.split(thousands).join('')
  } else if (lastComma !== -1 || lastDot !== -1) {
    const separator = lastComma !== -1 ? ',' : '.'
    const parts = body.split(separator)
    const isThousands =
      parts.length > 2 ||
      // A single dot followed by exactly three digits is a thousands separator
      // in German notation ("3.353"). A single comma is always a decimal comma.
      (separator === '.' && parts[1]?.length === 3 && /^[1-9]\d{0,2}$/.test(parts[0] ?? ''))
    if (isThousands) {
      if (!hasValidGrouping(body, separator)) return null
      integerPart = parts.join('')
    } else {
      integerPart = parts[0] ?? ''
      fractionPart = parts[1] ?? ''
    }
  } else {
    integerPart = body
  }

  if (!/^\d+$/.test(integerPart) || !/^\d*$/.test(fractionPart)) return null
  const value = Number(fractionPart === '' ? integerPart : `${integerPart}.${fractionPart}`)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

function hasValidGrouping(text: string, separator: string): boolean {
  const groups = text.split(separator)
  const [first, ...rest] = groups
  return (
    first !== undefined && /^\d{1,3}$/.test(first) && rest.every((group) => /^\d{3}$/.test(group))
  )
}

const CURRENCY = /^(?:euro|eur|€)\s*|\s*(?:euro|eur|€)$/gi

/** Parses a bare euro amount such as "EUR 245.000,00" or "€ 1.250.000,--". */
export function parseEur(raw: string): number | null {
  const value = parseGermanNumber(raw.trim().replace(CURRENCY, ''))
  return value !== null && value >= 0 ? value : null
}

const AREA_PREFIX = /^(?:ca\.?|rd\.?|rund|etwa)\s*/i
const AREA_UNIT = /\s*(?:m²|m2|m\^2|qm|quadratmeter)\.?$/i

/** Parses a bare area such as "65,76 m²", "3.353 m²" or "ca. 120 m2". */
export function parseSqm(raw: string): number | null {
  const value = parseGermanNumber(raw.trim().replace(AREA_PREFIX, '').replace(AREA_UNIT, ''))
  return value !== null && value > 0 ? value : null
}

export interface SqmMention {
  sqm: number
  /** The matched text, number and unit. */
  raw: string
  /** Offset of the match in the searched text. */
  index: number
}

// German thousands use dots ("1.234,56"); plain spaces are not accepted as
// separators because extracted PDF text often puts page numbers next to values.
const SQM_PATTERN =
  /(?<![\d.,])(\d{1,3}(?:[.\u202F]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s?(?:m²|m\s?2(?!\d)|m\^2|qm\b|quadratmeter\b)/gi

/** Finds every number followed by an area unit in free text. */
export function findSqmMentions(text: string): SqmMention[] {
  const mentions: SqmMention[] = []
  for (const match of text.matchAll(SQM_PATTERN)) {
    const sqm = match[1] === undefined ? null : parseGermanNumber(match[1])
    if (sqm !== null && sqm > 0) mentions.push({ sqm, raw: match[0], index: match.index })
  }
  return mentions
}
