import type { AnalysisResult, EvidenceItem, EvidenceStatus } from '@shared/analysis-schema'
import { parseGermanNumber } from '@shared/parse-numbers'
import type { AnalysisPage } from './types'

/** A fact in the answer that cites a page and quotes it. */
export interface EvidenceClaim {
  /** Path into the result, e.g. "areas.0". */
  path: string
  page: number | null
  quote: string | null
  /** The value the quote has to contain, for facts with a number. */
  value: number | null
}

export interface EvidenceContext {
  /** Every page of the document. */
  pages: readonly AnalysisPage[]
  /** Scanned pages the model received as images. */
  imagePages: readonly number[]
}

// Covers rounding of cents and of m² decimals.
const NUMBER_TOLERANCE = 0.01
// "…", "...", "[…]" and "(...)" join parts of a quote that are apart on the page.
const ELLIPSIS = /\[\s*\.{3,}\s*\]|\(\s*\.{3,}\s*\)|\.{3,}/
// Digits with German or English separators; no-break and thin spaces group thousands.
const NUMBER_TOKEN = /\d[\d.,'\u00A0\u2009\u202F]*\d|\d/g

/**
 * Checks every quoted fact against the page it cites: the quote has to appear
 * on that page, and the number in it has to match the extracted value.
 */
export function checkEvidence(result: AnalysisResult, context: EvidenceContext): EvidenceItem[] {
  const check = evidenceChecker(context)
  return evidenceClaims(result).map((claim) => ({
    path: claim.path,
    page: claim.page,
    status: check(claim),
  }))
}

export function evidenceClaims(result: AnalysisResult): EvidenceClaim[] {
  const claims: EvidenceClaim[] = result.areas.map((area, index) => ({
    path: `areas.${index}`,
    page: area.page,
    quote: area.quote,
    value: area.sqm,
  }))
  if (result.verkehrswert !== null) {
    const { page, quote, eur } = result.verkehrswert
    claims.push({ path: 'verkehrswert', page, quote, value: eur })
  }
  const { page, quote, monthly_rent_eur } = result.tenancy
  claims.push({ path: 'tenancy', page, quote, value: monthly_rent_eur })
  for (const key of ['encumbrances', 'arrears', 'defects'] as const) {
    result[key].forEach((finding, index) => {
      claims.push({
        path: `${key}.${index}`,
        page: finding.page,
        quote: finding.quote,
        value: finding.amount_eur,
      })
    })
  }
  result.risks.forEach((risk, index) => {
    claims.push({ path: `risks.${index}`, page: risk.page, quote: risk.quote, value: null })
  })
  return claims
}

export function evidenceChecker(
  context: EvidenceContext,
): (claim: EvidenceClaim) => EvidenceStatus {
  const pages = new Map(context.pages.map((page) => [page.pageNumber, page]))
  const images = new Set(context.imagePages)
  const normalized = new Map<number, string>()
  const pageText = (page: AnalysisPage): string => {
    const cached = normalized.get(page.pageNumber)
    if (cached !== undefined) return cached
    const text = normalizeForMatch(page.text)
    normalized.set(page.pageNumber, text)
    return text
  }

  return (claim) => {
    if (claim.quote === null) return 'no_quote'
    const fragments = quoteFragments(claim.quote)
    if (fragments.length === 0) return 'no_quote'
    if (claim.page === null) return 'quote_not_found'
    const page = pages.get(claim.page)
    if (page === undefined) return 'page_out_of_range'
    // A scan has no text to compare with. Unless the model saw its image, it
    // cannot have read the page at all.
    if (!page.hasText) return images.has(page.pageNumber) ? 'scanned_page' : 'quote_not_found'
    const text = pageText(page)
    if (!fragments.every((fragment) => text.includes(fragment))) return 'quote_not_found'
    if (claim.value !== null && !containsNumber(claim.quote, claim.value)) return 'number_mismatch'
    return 'verified'
  }
}

/**
 * The form quotes and page text are compared in: one Unicode form (m² and m2
 * meet, no-break spaces become spaces), one kind of dash and quotation mark,
 * lower case, end-of-line hyphenation joined, and no whitespace at all, since
 * PDF text breaks lines where the model writes spaces.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u201C-\u201F\u00AB\u00BB]/g, '"')
    .replace(/[\u2018-\u201B\u2039\u203A]/g, "'")
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .replace(/(\p{L})-\s*(?=\p{L})/gu, '$1')
    .replace(/\s+/g, '')
}

/** The parts of a quote, normalised, split where the model joined excerpts with an ellipsis. */
export function quoteFragments(quote: string): string[] {
  return quote
    .normalize('NFKC')
    .split(ELLIPSIS)
    .map((part) => normalizeForMatch(part).replace(/^["']+|["']+$/g, ''))
    .filter((part) => part !== '')
}

/** Every number written in the text, read in German or English notation. */
export function numbersIn(text: string): number[] {
  const numbers: number[] = []
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const value = parseGermanNumber(match[0])
    if (value !== null) numbers.push(value)
  }
  return numbers
}

function containsNumber(quote: string, value: number): boolean {
  return numbersIn(quote).some((number) => Math.abs(number - value) < NUMBER_TOLERANCE)
}
