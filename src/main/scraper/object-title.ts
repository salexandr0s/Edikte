import { CATEGORIES, type CategoryCode } from '@shared/edikte-codes'
import type { PropertyType } from '@shared/enums'

// Reads the object description of an edict, such as "Wohnung W 1+2, ER 1+2",
// "Geschäftslokal 1-4" or "KFZ-Abstellplatz 21". The Wohnungseigentum
// categories also cover parking spaces, shops and storage rooms, so the title
// says better what is for sale.

type UnitKind = 'dwelling' | 'commercial' | 'parking' | 'storage'

interface UnitWord {
  /** Folded, see `fold`. */
  word: string
  /** Null for words such as "Objekte" that name no kind. */
  kind: UnitKind | null
  /** A plural names several units. */
  plural: boolean
}

function unitWords(kind: UnitKind | null, plural: boolean, words: readonly string[]): UnitWord[] {
  return words.map((word) => ({ word: fold(word), kind, plural }))
}

// A word matches on its own or as the end of a compound: "stellplatz" also
// finds "KFZ-Stellplatz", "Garagenstellplatz" and "Stapelstellplatz".
const UNIT_WORDS: readonly UnitWord[] = [
  ...unitWords('dwelling', false, ['wohnung', 'maisonette', 'garconniere']),
  ...unitWords('dwelling', true, ['wohnungen', 'maisonetten']),
  ...unitWords('commercial', false, [
    'lokal',
    'geschäftsraum',
    'büro',
    'ordination',
    'praxis',
    'werkstätte',
    'werkstatt',
    'tankstelle',
  ]),
  ...unitWords('commercial', true, ['lokale', 'geschäftsräume', 'büros']),
  ...unitWords('parking', false, [
    'stellplatz',
    'parkplatz',
    'garage',
    'garagenplatz',
    'kfz',
    'pkw',
  ]),
  ...unitWords('parking', true, ['stellplätze', 'parkplätze', 'garagen', 'garagenplätze']),
  ...unitWords('storage', false, ['lager', 'lagerraum', 'magazin', 'abstellraum', 'kellerabteil']),
  ...unitWords('storage', true, ['lagerräume', 'abstellräume', 'kellerabteile']),
  ...unitWords(null, true, ['objekte', 'einheiten']),
]

/** A flat number such as "W4" or "W61". */
const FLAT_NUMBER = /^w\d+[a-z]?$/
/** A range of unit numbers: "Büro 5-8", "Top 17-18", "W61-W63". */
const UNIT_RANGE = /\d\s*[-–]\s*[a-z]{0,2}\s*\d/

interface TitleUnits {
  tokens: string[]
  kinds: Set<UnitKind>
  multipleUnits: boolean
}

function readTitle(title: string | null): TitleUnits {
  const text = fold(title ?? '')
  const tokens = text.split(/[^\p{L}\p{N}]+/u).filter((token) => token !== '')
  const kinds = new Set<UnitKind>()
  let plural = false
  // Parts joined by "und" or "sowie" that name a flat, a shop or a bare unit
  // number. A part with only a parking space or storage room does not count:
  // bundled parking has its own reason, and a storage room goes with its flat.
  let mainParts = 0
  let part = { main: false, accessory: false, number: false }
  const closePart = (): void => {
    if (part.main || (!part.accessory && part.number)) mainParts += 1
    part = { main: false, accessory: false, number: false }
  }
  for (const [index, token] of tokens.entries()) {
    if (token === 'und' || token === 'sowie') {
      closePart()
      continue
    }
    const match = matchWord(token, tokens[index + 1])
    if (match === null) {
      if (/^\d/.test(token)) part.number = true
      continue
    }
    if (match.plural) plural = true
    if (match.kind === null) continue
    kinds.add(match.kind)
    if (match.kind === 'dwelling' || match.kind === 'commercial') part.main = true
    else part.accessory = true
  }
  closePart()
  const multipleUnits = plural || text.includes('+') || UNIT_RANGE.test(text) || mainParts >= 2
  return { tokens, kinds, multipleUnits }
}

function matchWord(token: string, next: string | undefined): Omit<UnitWord, 'word'> | null {
  if (FLAT_NUMBER.test(token) || (token === 'w' && /^\d/.test(next ?? ''))) {
    return { kind: 'dwelling', plural: false }
  }
  return UNIT_WORDS.find(({ word }) => token.endsWith(word)) ?? null
}

/**
 * Property type of the first known category. For the apartment categories the
 * title decides: a title that names a flat stays an apartment, also next to a
 * parking space; a shop, office or petrol station is commercial; a parking
 * space or storage room is other.
 */
export function propertyTypeFor(
  categoryCodes: readonly string[],
  title: string | null,
): PropertyType {
  const code = categoryCodes.find(isCategoryCode)
  if (code === undefined) return 'other'
  const type = CATEGORIES[code].propertyType
  if (type !== 'apartment') return type
  const { kinds } = readTitle(title)
  if (kinds.has('dwelling')) return 'apartment'
  if (kinds.has('commercial')) return 'commercial'
  if (kinds.has('parking') || kinds.has('storage')) return 'other'
  return 'apartment'
}

/** Reasons for an approximate €/m² that the title and category give without an analysis. */
export interface TitleApproximation {
  /** A share of the property: Hausanteil, Hälfteanteil, schlichtes Miteigentum. */
  partialOwnership: boolean
  /** Several flats or shops for one price: "W 1+2", "Büro 5-8", "Wohnung 6 und 8", "Wohnungen". */
  multipleUnits: boolean
  /** A flat or shop sold together with a parking space. */
  bundledParking: boolean
}

export function approximationFromTitle(
  title: string | null,
  categoryCodes: readonly string[],
): TitleApproximation {
  const { tokens, kinds, multipleUnits } = readTitle(title)
  return {
    partialOwnership: isPartialOwnership(tokens, categoryCodes),
    multipleUnits,
    bundledParking: kinds.has('parking') && (kinds.has('dwelling') || kinds.has('commercial')),
  }
}

function isPartialOwnership(tokens: readonly string[], categoryCodes: readonly string[]): boolean {
  const has = (test: (token: string) => boolean): boolean => tokens.some(test)
  if (categoryCodes.includes('HAN')) return true
  // A half share is part of a property even when the property is a Wohnungseigentum unit.
  if (has((token) => token === 'halfte' || /halfteanteile?$/.test(token))) return true
  const miteigentum = has((token) => token.startsWith('miteigentum'))
  if (miteigentum && has((token) => token.startsWith('schlicht'))) return true
  // Otherwise every Wohnungseigentum unit is a share of the building and is sold whole.
  const wohnungseigentum =
    categoryCodes.some(
      (code) => isCategoryCode(code) && CATEGORIES[code].propertyType === 'apartment',
    ) || has((token) => token.startsWith('wohnungseigentum'))
  return !wohnungseigentum && (miteigentum || has((token) => /anteile?$/.test(token)))
}

function isCategoryCode(code: string): code is CategoryCode {
  return Object.hasOwn(CATEGORIES, code)
}

/** Lowercase without diacritics, so composed and decomposed umlauts read alike. */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss')
}
