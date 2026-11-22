import { priceForBasis } from '@shared/area'
import type { ListingRow } from '@shared/domain'
import type { PriceBasis } from '@shared/enums'

export interface PublishedPrice {
  basis: PriceBasis
  amount: number
}

/** A display value for a preview. Filters and €/m² keep the user's selected basis. */
export function publishedPrice(row: ListingRow): PublishedPrice | null {
  const selected = priceForBasis(row.priceBasis, row)
  if (selected !== null) return { basis: row.priceBasis, amount: selected }
  if (row.source !== 'court_auction') return null
  const basis = row.priceBasis === 'schaetzwert' ? 'geringstes_gebot' : 'schaetzwert'
  const amount = priceForBasis(basis, row)
  return amount === null ? null : { basis, amount }
}
