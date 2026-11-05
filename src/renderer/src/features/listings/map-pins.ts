import { priceForBasis } from '@shared/area'
import type { ListingRow } from '@shared/domain'

// The pins behind the map, without Leaflet or the DOM, so they run under Vitest.

/** The auctions at one position, cheapest first. */
export interface Pin {
  key: string
  lat: number
  lng: number
  /** Only the town is known for every auction at this pin. */
  approximate: boolean
  rows: ListingRow[]
}

/** One pin per position; auctions whose address resolved to the same point share it. */
export function groupPins(rows: ListingRow[]): Pin[] {
  const byKey = new Map<string, Pin>()
  for (const row of rows) {
    const location = row.location
    if (location === null) continue
    const key = `${location.lat.toFixed(5)},${location.lng.toFixed(5)}`
    const pin = byKey.get(key)
    if (pin === undefined) {
      byKey.set(key, {
        key,
        lat: location.lat,
        lng: location.lng,
        approximate: location.precision === 'place',
        rows: [row],
      })
    } else {
      pin.rows.push(row)
      if (location.precision !== 'place') pin.approximate = false
    }
  }
  for (const pin of byKey.values()) pin.rows.sort(byPrice)
  return [...byKey.values()]
}

/** Cheapest first on each row's own price basis; rows without a price go last. */
function byPrice(a: ListingRow, b: ListingRow): number {
  const priceA = priceForBasis(a.priceBasis, a) ?? Number.POSITIVE_INFINITY
  const priceB = priceForBasis(b.priceBasis, b) ?? Number.POSITIVE_INFINITY
  return priceA - priceB
}

/** The same pins in any order give the same signature. */
export function pinsSignature(pins: Pin[]): string {
  return pins
    .map((pin) => pin.key)
    .sort()
    .join(';')
}
