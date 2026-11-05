import { priceForBasis, pricePerSqm } from './area'
import type { ListingPage, ListingQuery, ListingRow } from './domain'
import type { PriceBasis } from './enums'

/**
 * Filters and sorts listings in memory. A synced scope holds a few hundred
 * edicts, so main builds every row and applies the query here; the renderer's
 * mock bridge uses the same code, and both agree on what each filter means.
 */
export function applyListingQuery(rows: readonly ListingRow[], query: ListingQuery): ListingPage {
  const matches = rows
    .map((row) => withPriceBasis(row, query.priceBasis))
    .filter((row) => matchesListingQuery(row, query))
    .sort(compareListings(query.sort))
  return { rows: matches, totalInScope: rows.length }
}

/** Recomputes the row's €/m² for a price basis. */
export function withPriceBasis(row: ListingRow, basis: PriceBasis): ListingRow {
  return {
    ...row,
    priceBasis: basis,
    pricePerSqm: pricePerSqm(priceForBasis(basis, row), row.area?.sqm ?? null),
  }
}

/** Expects a row from `withPriceBasis` for the query's price basis. */
export function matchesListingQuery(row: ListingRow, query: ListingQuery): boolean {
  if (row.hidden && !query.showHidden) return false
  if (query.starredOnly && !row.starred) return false
  if (query.analyzedOnly && !row.hasAnalysis) return false
  if (!isListed(query.statuses, row.status)) return false
  if (!isListed(query.bundeslaender, row.bundesland)) return false
  if (!isListed(query.bezirke, row.bezirk)) return false
  if (!isListed(query.propertyTypes, row.propertyType)) return false
  if (!isListed(query.riskLevels, row.riskLevel)) return false

  if (!inRange(priceForBasis(query.priceBasis, row), query.minPrice, query.maxPrice)) return false

  if (row.area === null) {
    const needsArea =
      query.maxPricePerSqm !== null || query.minArea !== null || query.maxArea !== null
    if (needsArea && !query.includeWithoutArea) return false
  } else {
    if (!inRange(row.pricePerSqm, null, query.maxPricePerSqm)) return false
    if (!inRange(row.area.sqm, query.minArea, query.maxArea)) return false
  }

  const auctionDay = row.auctionAt?.slice(0, 10) ?? null
  if (query.auctionFrom !== null && (auctionDay === null || auctionDay < query.auctionFrom)) {
    return false
  }
  if (query.auctionTo !== null && (auctionDay === null || auctionDay > query.auctionTo)) {
    return false
  }
  return matchesText(row, query)
}

/** Sorts by the chosen column with empty values last, then by auction date and ID. */
export function compareListings(
  sort: ListingQuery['sort'],
): (a: ListingRow, b: ListingRow) => number {
  const direction = sort.direction === 'asc' ? 1 : -1
  return (a, b) =>
    compareNullable(sortValue(a, sort.column), sortValue(b, sort.column), direction) ||
    compareNullable(a.auctionAt, b.auctionAt, 1) ||
    a.id.localeCompare(b.id)
}

function sortValue(
  row: ListingRow,
  column: ListingQuery['sort']['column'],
): string | number | null {
  switch (column) {
    case 'auctionAt':
      return row.auctionAt
    case 'publishedAt':
      return row.publishedAt
    case 'pricePerSqm':
      return row.pricePerSqm
    case 'price':
      return priceForBasis(row.priceBasis, row)
    case 'area':
      return row.area?.sqm ?? null
    case 'bezirk':
      return row.bezirk
  }
}

function compareNullable<T extends string | number>(
  a: T | null,
  b: T | null,
  direction: 1 | -1,
): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  if (a === b) return 0
  return (a < b ? -1 : 1) * direction
}

/** An empty list means "no restriction"; an unknown value never matches a restriction. */
function isListed<T>(allowed: readonly T[], value: T | null): boolean {
  if (allowed.length === 0) return true
  return value !== null && allowed.includes(value)
}

function inRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true
  if (value === null) return false
  return (min === null || value >= min) && (max === null || value <= max)
}

function matchesText(row: ListingRow, query: ListingQuery): boolean {
  const terms = normalizeText(query.text).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = normalizeText(
    [row.title, row.street, row.plz, row.city, row.court, row.caseNumber, row.categoryLabel]
      .filter((part) => part !== null)
      .join(' '),
  )
  return terms.every((term) => haystack.includes(term))
}

/** Lowercase, without accents, with ß as ss: "Straße" matches "strasse". */
function normalizeText(text: string): string {
  return text.toLowerCase().replaceAll('ß', 'ss').normalize('NFKD').replace(/\p{M}/gu, '')
}
