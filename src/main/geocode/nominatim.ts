import { z } from 'zod'
import type { ListingLocation, LocationPrecision } from '@shared/domain'
import { AppError } from '@shared/errors'
import type { GeocodeQuery } from './address'

// Address lookup at Nominatim (OpenStreetMap). Its usage policy asks for at
// most one request per second, an identifying User-Agent and cached answers;
// the service stores every answer, so an address is sent once.

export const NOMINATIM_ORIGIN = 'https://nominatim.openstreetmap.org'
/** Stored with each answer, so another provider's answers can be told apart later. */
export const NOMINATIM_PROVIDER = 'nominatim'

export interface Geocoder {
  /** The position of an address, or null when the service does not know it. */
  lookup(query: GeocodeQuery, signal?: AbortSignal): Promise<ListingLocation | null>
}

export interface NominatimOptions {
  /** `userAgent(appVersion)` from src/main/scraper/client.ts. */
  userAgent: string
  /** Defaults to Node's global fetch; tests inject a fake. */
  fetch?: typeof globalThis.fetch
  /** Minimum time between the starts of two requests. */
  minIntervalMs?: number
  timeoutMs?: number
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

const DEFAULTS = { minIntervalMs: 1_100, timeoutMs: 20_000 }

const PlaceSchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    place_rank: z.number().int().optional(),
    addresstype: z.string().optional(),
    address: z.object({ postcode: z.string().optional() }).loose().optional(),
  })
  .loose()
const ResultsSchema = z.array(PlaceSchema)
type Place = z.infer<typeof PlaceSchema>

interface SearchParts {
  street?: string
  postalcode?: string
  city?: string
}

export function createNominatimGeocoder(options: NominatimOptions): Geocoder {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const minIntervalMs = options.minIntervalMs ?? DEFAULTS.minIntervalMs
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? defaultSleep
  let nextAt = 0

  const search = async (parts: SearchParts, signal?: AbortSignal): Promise<Place | null> => {
    const wait = nextAt - now()
    if (wait > 0) await sleep(wait, signal)
    nextAt = now() + minIntervalMs
    const response = await send(fetchImpl, searchUrl(parts), options.userAgent, timeoutMs, signal)
    const places = await parse(response)
    return places[0] ?? null
  }

  return {
    async lookup(query, signal) {
      if (query.street !== null) {
        const parts: SearchParts = { street: query.street }
        if (query.plz !== null) parts.postalcode = query.plz
        if (query.city !== null) parts.city = query.city
        const hit = await search(parts, signal)
        if (hit !== null && postcodeMatches(hit, query.plz)) {
          return { lat: hit.lat, lng: hit.lon, precision: precisionOf(hit) }
        }
      }
      const parts: SearchParts = {}
      if (query.plz !== null) parts.postalcode = query.plz
      if (query.city !== null) parts.city = query.city
      const place = await search(parts, signal)
      return place === null ? null : { lat: place.lat, lng: place.lon, precision: 'place' }
    },
  }
}

/** The structured search address, as the policy prefers over free text. */
export function searchUrl(parts: SearchParts): string {
  const url = new URL('/search', NOMINATIM_ORIGIN)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '1')
  url.searchParams.set('countrycodes', 'at')
  url.searchParams.set('country', 'Austria')
  if (parts.street !== undefined) url.searchParams.set('street', parts.street)
  if (parts.postalcode !== undefined) url.searchParams.set('postalcode', parts.postalcode)
  if (parts.city !== undefined) url.searchParams.set('city', parts.city)
  return url.toString()
}

/** A street hit in another postcode is a street of the same name somewhere else. */
function postcodeMatches(place: Place, plz: string | null): boolean {
  const found = place.address?.postcode
  return plz === null || found === undefined || found.trim() === plz
}

/** Nominatim ranks houses at 30, streets at 26 to 28 and towns and postcodes below that. */
function precisionOf(place: Place): LocationPrecision {
  const type = place.addresstype
  if (type === 'road' || type === 'street') return 'street'
  const rank = place.place_rank ?? 0
  if (rank >= 29) return 'address'
  if (rank >= 26) return 'street'
  return 'place'
}

async function send(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  userAgent: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  try {
    return await fetchImpl(url, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json',
        'Accept-Language': 'de',
      },
      redirect: 'follow',
      signal: combined,
    })
  } catch (error) {
    if (signal?.aborted === true) throw new AppError('cancelled', 'Address lookup cancelled')
    if (timeout.aborted) throw new AppError('timeout', 'The address service did not answer')
    throw new AppError('network', 'The address service could not be reached', { cause: error })
  }
}

async function parse(response: Response): Promise<Place[]> {
  if (response.status === 429 || response.status === 403) {
    await discard(response)
    throw new AppError('rate_limited', 'The address service asked for a pause')
  }
  if (response.status >= 500) {
    await discard(response)
    throw new AppError('site_unavailable', `The address service answered ${response.status}`)
  }
  if (!response.ok) {
    await discard(response)
    throw new AppError('site_changed', `The address service answered ${response.status}`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new AppError('site_changed', 'The address service sent no JSON', { cause: error })
  }
  const parsed = ResultsSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('site_changed', 'The address service sent an unexpected answer')
  }
  return parsed.data
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The body is of no use either way.
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AppError('cancelled', 'Address lookup cancelled'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new AppError('cancelled', 'Address lookup cancelled'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
