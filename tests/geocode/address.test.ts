import { describe, expect, it } from 'vitest'
import { geocodeQuery, streetForLookup } from '../../src/main/geocode/address'

describe('streetForLookup', () => {
  it('keeps the street and its first house number', () => {
    expect(streetForLookup('Beispielgasse 12/3/7')).toBe('Beispielgasse 12')
    expect(streetForLookup('Hauptstraße 10, Top 4')).toBe('Hauptstraße 10')
    expect(streetForLookup('Gartenstraße 9 Top 2')).toBe('Gartenstraße 9')
    expect(streetForLookup('Neubaugasse 12 - 14')).toBe('Neubaugasse 12')
    expect(streetForLookup('Wiener Straße 8a')).toBe('Wiener Straße 8a')
    expect(streetForLookup('  Am  Beispielhang ')).toBe('Am Beispielhang')
  })

  it('has nothing for an empty street', () => {
    expect(streetForLookup(null)).toBeNull()
    expect(streetForLookup('   ')).toBeNull()
  })
})

describe('geocodeQuery', () => {
  it('needs a town or a postcode', () => {
    expect(geocodeQuery({ street: 'Beispielgasse 12', plz: null, city: null })).toBeNull()
    expect(geocodeQuery({ street: null, plz: '1220', city: null })).toMatchObject({
      street: null,
      plz: '1220',
      city: null,
    })
  })

  it('keys the same address the same way whatever the spelling of case and spaces', () => {
    const a = geocodeQuery({ street: 'Beispielgasse 12/5', plz: '1220', city: 'Wien' })
    const b = geocodeQuery({ street: 'beispielgasse  12/7', plz: ' 1220', city: 'WIEN' })
    expect(a?.key).toBe('beispielgasse 12|1220|wien')
    expect(b?.key).toBe(a?.key)
  })
})
