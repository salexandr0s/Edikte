import { priceForBasis } from '@shared/area'
import type { ListingRow } from '@shared/domain'

// The pins behind the map, without Leaflet or the DOM, so they run under Vitest.

/** The auctions at one position, cheapest first. */
export interface Place {
  key: string
  lat: number
  lng: number
  /** Only the town is known for every auction here. */
  approximate: boolean
  rows: ListingRow[]
}

/** What the map draws: one place, or several whose labels would overlap at the zoom. */
export interface Pin extends Place {
  places: Place[]
}

/** A position in pixels at one zoom, as Leaflet's `project` gives it. */
export interface Point {
  x: number
  y: number
}

/**
 * Nearer than this on screen, two labels would overlap: a label is up to
 * 180 px wide and 24 px high and hangs above its point.
 */
export const LABEL_GAP: Point = { x: 120, y: 30 }

/** One place per position; auctions whose address resolved to the same point share it. */
export function groupPins(rows: ListingRow[]): Place[] {
  const byKey = new Map<string, Place>()
  for (const row of rows) {
    const location = row.location
    if (location === null) continue
    const key = `${location.lat.toFixed(5)},${location.lng.toFixed(5)}`
    const place = byKey.get(key)
    if (place === undefined) {
      byKey.set(key, {
        key,
        lat: location.lat,
        lng: location.lng,
        approximate: location.precision === 'place',
        rows: [row],
      })
    } else {
      place.rows.push(row)
      if (location.precision !== 'place') place.approximate = false
    }
  }
  for (const place of byKey.values()) place.rows.sort(byPrice)
  return [...byKey.values()]
}

/**
 * The pins for one zoom. Places are taken north to south; each one not yet
 * drawn takes every later place whose label would overlap its own into one
 * pin at their middle, with all their auctions. The same view gives the same
 * pins, so a chosen pin keeps its key while the zoom does not change.
 */
export function clusterPins(places: Place[], project: (place: Place) => Point): Pin[] {
  const projected = places
    .map((place) => ({ place, point: project(place) }))
    .sort((a, b) => a.point.y - b.point.y || a.point.x - b.point.x)
  const taken = new Set<string>()
  const pins: Pin[] = []
  for (const anchor of projected) {
    if (taken.has(anchor.place.key)) continue
    taken.add(anchor.place.key)
    const members = [anchor.place]
    for (const other of projected) {
      if (taken.has(other.place.key)) continue
      if (
        Math.abs(other.point.x - anchor.point.x) < LABEL_GAP.x &&
        Math.abs(other.point.y - anchor.point.y) < LABEL_GAP.y
      ) {
        taken.add(other.place.key)
        members.push(other.place)
      }
    }
    pins.push(members.length === 1 ? { ...anchor.place, places: members } : cluster(members))
  }
  return pins
}

function cluster(members: Place[]): Pin {
  return {
    key: members.map((place) => place.key).join('+'),
    lat: members.reduce((sum, place) => sum + place.lat, 0) / members.length,
    lng: members.reduce((sum, place) => sum + place.lng, 0) / members.length,
    approximate: members.every((place) => place.approximate),
    rows: members.flatMap((place) => place.rows).sort(byPrice),
    places: members,
  }
}

/** Cheapest first on each row's own price basis; rows without a price go last. */
function byPrice(a: ListingRow, b: ListingRow): number {
  const priceA = priceForBasis(a.priceBasis, a) ?? Number.POSITIVE_INFINITY
  const priceB = priceForBasis(b.priceBasis, b) ?? Number.POSITIVE_INFINITY
  return priceA - priceB
}

/** The same places in any order give the same signature. */
export function pinsSignature(places: Place[]): string {
  return places
    .map((place) => place.key)
    .sort()
    .join(';')
}
