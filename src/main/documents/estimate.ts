import { AREA_MISMATCH_THRESHOLD, usableAreaKinds } from '@shared/area'
import type { AreaKind, PropertyType } from '@shared/enums'
import { findSqmMentions, type SqmMention } from '@shared/parse-numbers'

// Local m² estimate without AI: a text scan over the extracted pages.

export interface EstimatePage {
  /** 1-based PDF page number. */
  pageNumber: number
  text: string
}

export interface LocalAreaEstimate {
  kind: AreaKind
  sqm: number
  /** 1-based PDF page. */
  page: number
  /** Verbatim text from the page, at most 200 characters. */
  quote: string
  confidence: 'low' | 'medium'
  /** How the value was found, stored with the estimate. */
  method: string
}

type Method = 'same-line-total' | 'same-line' | 'block-total' | 'next-line'

interface Candidate extends LocalAreaEstimate {
  rank: number
  mixed: boolean
}

const MAX_QUOTE = 200
/** Lines after a heading such as "2.8. Nutzfläche" searched for its table. */
const BLOCK_LINES = 10
const METHOD_RANK: Record<Method, number> = {
  'same-line-total': 0,
  'same-line': 1,
  'block-total': 2,
  'next-line': 3,
}

// Comparable sales list other flats' areas, so their pages are skipped whole.
const COMPARABLES =
  /vergleichswert|vergleichsobjekt|kaufpreissammlung|vergleichspreis|vergleichsfl(?:ä|ae)che|vergleichswohnung/i
const AREA_KEYWORD =
  /wohnnutzfl(?:ä|ae)che|wohnfl(?:ä|ae)che|nutzfl(?:ä|ae)che|grundst(?:ü|ue)cksfl(?:ä|ae)che|grundfl(?:ä|ae)che/gi
const TOTAL = /gesamt|summe/i
// Areas that a price per m² must not include; their presence lowers confidence.
const ACCESSORY = /keller|loggia|balkon|terrasse|garten|garage|stellplatz|abstellraum|dachboden/i
const NUMBERED_HEADING = /^\d+(?:\.\d+)*\.?\s+\p{Lu}/u
/** A mention before the keyword ("65,76 m² Nutzfläche") must be this close. */
const MAX_LEADING_DISTANCE = 30

const PLAUSIBLE_SQM: Record<'living' | 'plot', readonly [number, number]> = {
  living: [8, 50_000],
  plot: [10, 10_000_000],
}

/**
 * Estimates the area a listing's €/m² can use from the Gutachten text: a
 * Nutzfläche, Wohnfläche or Wohnnutzfläche (Grundfläche for plots) followed by
 * a value in m², m2 or qm. Pages about comparables are skipped, totals are
 * preferred, and the area kinds follow the property type.
 */
export function estimateArea(
  pages: readonly EstimatePage[],
  propertyType: PropertyType,
): LocalAreaEstimate | null {
  const kinds = usableAreaKinds(propertyType)
  const candidates = findAreaCandidates(pages)
    .filter((candidate) => kinds.includes(candidate.kind))
    .sort(
      (a, b) => a.rank - b.rank || kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.page - b.page,
    )
  const best = candidates[0]
  if (best === undefined) return null
  const disputed = candidates.some(
    (other) =>
      other.kind === best.kind &&
      other.rank <= METHOD_RANK['same-line'] &&
      Math.abs(other.sqm - best.sqm) / best.sqm > AREA_MISMATCH_THRESHOLD,
  )
  const confident = best.rank <= METHOD_RANK['same-line'] && !best.mixed && !disputed
  return {
    kind: best.kind,
    sqm: best.sqm,
    page: best.page,
    quote: best.quote,
    confidence: confident ? 'medium' : 'low',
    method: best.method,
  }
}

/** Every area statement found, before the choice by property type. */
export function findAreaCandidates(pages: readonly EstimatePage[]): Candidate[] {
  const candidates: Candidate[] = []
  for (const page of pages) {
    if (COMPARABLES.test(page.text)) continue
    const lines = page.text.split('\n')
    lines.forEach((line, index) => {
      for (const match of line.matchAll(AREA_KEYWORD)) {
        const kind = kindForKeyword(match[0])
        const found =
          sameLineCandidate(line, match.index, match[0].length) ?? blockCandidate(lines, index)
        if (found === null || !isPlausible(kind, found.sqm)) continue
        candidates.push({
          kind,
          sqm: found.sqm,
          page: page.pageNumber,
          quote: found.quote,
          method: `text-scan:${found.method}`,
          confidence: 'low',
          rank: METHOD_RANK[found.method] + (found.mixed ? 2 : 0),
          mixed: found.mixed,
        })
      }
    })
  }
  return candidates
}

interface Found {
  sqm: number
  quote: string
  method: Method
  /** The value includes or sits next to cellar, balcony or similar areas. */
  mixed: boolean
}

function sameLineCandidate(line: string, keywordAt: number, keywordLength: number): Found | null {
  const keywordEnd = keywordAt + keywordLength
  const after = findSqmMentions(line.slice(keywordEnd))[0]
  let mention: SqmMention | undefined
  let start: number
  let end: number
  if (after !== undefined) {
    mention = after
    start = keywordAt
    end = keywordEnd + after.index + after.raw.length
  } else {
    mention = findSqmMentions(line.slice(0, keywordAt)).at(-1)
    if (mention === undefined) return null
    start = mention.index
    end = keywordEnd
    if (keywordAt - (mention.index + mention.raw.length) > MAX_LEADING_DISTANCE) return null
  }
  const total = TOTAL.test(line)
  return {
    sqm: mention.sqm,
    quote: quoteFrom(line, start, end),
    method: total ? 'same-line-total' : 'same-line',
    mixed: ACCESSORY.test(line.slice(start, end)),
  }
}

function blockCandidate(lines: readonly string[], keywordLine: number): Found | null {
  if (findSqmMentions(lines[keywordLine] ?? '').length > 0) return null
  const valueLines: number[] = []
  for (let index = keywordLine + 1; index <= keywordLine + BLOCK_LINES; index += 1) {
    const line = lines[index]
    if (line === undefined || NUMBERED_HEADING.test(line) || hasKeyword(line)) break
    if (findSqmMentions(line).length === 0) continue
    valueLines.push(index)
    if (TOTAL.test(line)) {
      // Quote the run of value rows that ends in the total, as printed.
      let first = valueLines.length - 1
      while (first > 0 && valueLines[first - 1] === (valueLines[first] ?? 0) - 1) first -= 1
      const block = valueLines.slice(first).map((at) => lines[at] ?? '')
      const quote = block.join('\n')
      const mentions = findSqmMentions(line)
      const value = mentions.at(-1)
      if (value === undefined) return null
      return {
        sqm: value.sqm,
        quote: quote.length <= MAX_QUOTE ? quote : quoteFrom(line, 0, line.length),
        method: 'block-total',
        mixed: block.some((row) => ACCESSORY.test(row)),
      }
    }
  }
  const only = valueLines.length === 1 ? valueLines[0] : undefined
  if (only === undefined) return null
  const line = lines[only] ?? ''
  const mentions = findSqmMentions(line)
  const value = mentions[0]
  if (mentions.length !== 1 || value === undefined) return null
  return {
    sqm: value.sqm,
    quote: quoteFrom(line, 0, line.length),
    method: 'next-line',
    mixed: ACCESSORY.test(line),
  }
}

function hasKeyword(line: string): boolean {
  return line.search(AREA_KEYWORD) !== -1
}

function kindForKeyword(keyword: string): AreaKind {
  const lower = keyword.toLowerCase()
  if (lower.startsWith('wohn')) return 'wohnflaeche'
  if (lower.startsWith('nutz')) return 'nutzflaeche'
  return 'grundflaeche'
}

function isPlausible(kind: AreaKind, sqm: number): boolean {
  const [min, max] = PLAUSIBLE_SQM[kind === 'grundflaeche' ? 'plot' : 'living']
  return sqm >= min && sqm <= max
}

/** The whole line when it fits, otherwise the part from keyword to value. */
function quoteFrom(line: string, start: number, end: number): string {
  const trimmed = line.trim()
  if (trimmed.length <= MAX_QUOTE) return trimmed
  const part = line.slice(start, end).trim()
  return part.length <= MAX_QUOTE ? part : part.slice(part.length - MAX_QUOTE)
}
