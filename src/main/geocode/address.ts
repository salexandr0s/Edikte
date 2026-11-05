// The address an edict is looked up by. Electron-free so the rules can run in Node.

export interface AddressFields {
  street: string | null
  plz: string | null
  city: string | null
}

/** What the geocoder is asked for, and the key its answer is cached under. */
export interface GeocodeQuery {
  /** The three parts below in lower case, joined with `|`; edicts with the same key share an answer. */
  key: string
  /** Street and house number without door, stair or range suffixes. */
  street: string | null
  plz: string | null
  city: string | null
}

/** Door numbers and stairs after the house number, which the geocoder cannot place. */
const SUFFIX = /\s*(?:[/,].*|\s(?:top|tür|tuer|stiege|stg\.?|eg|og|dg)\b.*)$/i
/** "12-14" and "12 – 14": the first number of a range is enough. */
const RANGE = /(\d+[a-z]?)\s*[-–]\s*\d+[a-z]?/i

/** The geocoder query for an address, or null when there is no town or postcode to look up. */
export function geocodeQuery(address: AddressFields): GeocodeQuery | null {
  const street = streetForLookup(address.street)
  const plz = clean(address.plz)
  const city = clean(address.city)
  if (plz === null && city === null) return null
  const key = [street, plz, city].map((part) => part?.toLowerCase() ?? '').join('|')
  return { key, street, plz, city }
}

/** The street with its first house number, or null when there is no street. */
export function streetForLookup(street: string | null): string | null {
  const text = clean(street)
  if (text === null) return null
  return clean(text.replace(SUFFIX, '').replace(RANGE, '$1'))
}

function clean(value: string | null): string | null {
  if (value === null) return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}
