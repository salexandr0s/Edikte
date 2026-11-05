import { describe, expect, it } from 'vitest'
import { isAppError } from '@shared/errors'
import { geocodeQuery } from '../../src/main/geocode/address'
import { createNominatimGeocoder, searchUrl } from '../../src/main/geocode/nominatim'

// The structured search and how its answers become positions. Addresses are made up.

const query = geocodeQuery({ street: 'Beispielgasse 12', plz: '1220', city: 'Wien' })
if (query === null) throw new Error('query')

function answering(...answers: Array<{ status?: number; body: unknown }>): {
  fetch: typeof fetch
  urls: string[]
} {
  const urls: string[] = []
  const fetchImpl: typeof fetch = (input) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const answer = answers.shift() ?? { body: [] }
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
  return { fetch: fetchImpl, urls }
}

const house = {
  lat: '48.2127196',
  lon: '16.3797905',
  place_rank: 30,
  addresstype: 'building',
  address: { postcode: '1220' },
}

describe('createNominatimGeocoder', () => {
  it('asks with the structured address and the identifying User-Agent', async () => {
    let headers: Headers | null = null
    const fetchImpl: typeof fetch = (_input, init) => {
      headers = new Headers(init?.headers)
      return Promise.resolve(Response.json([house]))
    }
    const geocoder = createNominatimGeocoder({
      fetch: fetchImpl,
      userAgent: 'Edikte/test',
      minIntervalMs: 0,
    })
    await expect(geocoder.lookup(query)).resolves.toEqual({
      lat: 48.2127196,
      lng: 16.3797905,
      precision: 'address',
    })
    expect(new Headers(headers ?? undefined).get('user-agent')).toBe('Edikte/test')
    const url = new URL(searchUrl({ street: 'Beispielgasse 12', postalcode: '1220', city: 'Wien' }))
    expect(url.origin).toBe('https://nominatim.openstreetmap.org')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      street: 'Beispielgasse 12',
      postalcode: '1220',
      city: 'Wien',
      countrycodes: 'at',
      format: 'jsonv2',
      limit: '1',
    })
  })

  it('falls back to the town when the street is unknown', async () => {
    const town = { lat: '48.2', lon: '16.4', place_rank: 16, addresstype: 'town' }
    const { fetch: fetchImpl, urls } = answering({ body: [] }, { body: [town] })
    const geocoder = createNominatimGeocoder({
      fetch: fetchImpl,
      userAgent: 'Edikte/test',
      minIntervalMs: 0,
    })
    await expect(geocoder.lookup(query)).resolves.toEqual({
      lat: 48.2,
      lng: 16.4,
      precision: 'place',
    })
    expect(urls).toHaveLength(2)
    expect(new URL(urls[1] ?? '').searchParams.has('street')).toBe(false)
  })

  it('does not take a street of the same name in another postcode', async () => {
    const elsewhere = { ...house, address: { postcode: '1030' } }
    const { fetch: fetchImpl, urls } = answering({ body: [elsewhere] }, { body: [] })
    const geocoder = createNominatimGeocoder({
      fetch: fetchImpl,
      userAgent: 'Edikte/test',
      minIntervalMs: 0,
    })
    await expect(geocoder.lookup(query)).resolves.toBeNull()
    expect(urls).toHaveLength(2)
  })

  it('reads a street-level hit as street precision', async () => {
    const road = { lat: '48.21', lon: '16.38', place_rank: 26, addresstype: 'road' }
    const { fetch: fetchImpl } = answering({ body: [road] })
    const geocoder = createNominatimGeocoder({
      fetch: fetchImpl,
      userAgent: 'Edikte/test',
      minIntervalMs: 0,
    })
    await expect(geocoder.lookup(query)).resolves.toMatchObject({ precision: 'street' })
  })

  it('waits between requests', async () => {
    let clock = 0
    const waits: number[] = []
    const { fetch: fetchImpl } = answering({ body: [house] }, { body: [house] })
    const geocoder = createNominatimGeocoder({
      fetch: fetchImpl,
      userAgent: 'Edikte/test',
      minIntervalMs: 1_100,
      now: () => clock,
      sleep: (ms) => {
        waits.push(ms)
        clock += ms
        return Promise.resolve()
      },
    })
    await geocoder.lookup(query)
    clock += 300
    await geocoder.lookup(query)
    expect(waits).toEqual([800])
  })

  it('reports a pause the service asks for as rate_limited', async () => {
    const { fetch: fetchImpl } = answering({ status: 429, body: {} })
    const geocoder = createNominatimGeocoder({
      fetch: fetchImpl,
      userAgent: 'Edikte/test',
      minIntervalMs: 0,
    })
    const failure = await geocoder.lookup(query).catch((error: unknown) => error)
    expect(isAppError(failure) && failure.code).toBe('rate_limited')
  })

  it('reports an answer it cannot read as site_changed', async () => {
    const { fetch: fetchImpl } = answering({ body: [{ lat: 'north', lon: '16' }] })
    const geocoder = createNominatimGeocoder({
      fetch: fetchImpl,
      userAgent: 'Edikte/test',
      minIntervalMs: 0,
    })
    const failure = await geocoder.lookup(query).catch((error: unknown) => error)
    expect(isAppError(failure) && failure.code).toBe('site_changed')
  })
})
