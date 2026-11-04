// District data ported from immoradar packages/contracts/src/domain.ts.

export interface WienBezirk {
  number: number
  name: string
  plz: string
}

export const WIEN_BEZIRKE: readonly WienBezirk[] = [
  { number: 1, name: 'Innere Stadt', plz: '1010' },
  { number: 2, name: 'Leopoldstadt', plz: '1020' },
  { number: 3, name: 'Landstraße', plz: '1030' },
  { number: 4, name: 'Wieden', plz: '1040' },
  { number: 5, name: 'Margareten', plz: '1050' },
  { number: 6, name: 'Mariahilf', plz: '1060' },
  { number: 7, name: 'Neubau', plz: '1070' },
  { number: 8, name: 'Josefstadt', plz: '1080' },
  { number: 9, name: 'Alsergrund', plz: '1090' },
  { number: 10, name: 'Favoriten', plz: '1100' },
  { number: 11, name: 'Simmering', plz: '1110' },
  { number: 12, name: 'Meidling', plz: '1120' },
  { number: 13, name: 'Hietzing', plz: '1130' },
  { number: 14, name: 'Penzing', plz: '1140' },
  { number: 15, name: 'Rudolfsheim-Fünfhaus', plz: '1150' },
  { number: 16, name: 'Ottakring', plz: '1160' },
  { number: 17, name: 'Hernals', plz: '1170' },
  { number: 18, name: 'Währing', plz: '1180' },
  { number: 19, name: 'Döbling', plz: '1190' },
  { number: 20, name: 'Brigittenau', plz: '1200' },
  { number: 21, name: 'Floridsdorf', plz: '1210' },
  { number: 22, name: 'Donaustadt', plz: '1220' },
  { number: 23, name: 'Liesing', plz: '1230' },
]

const bezirkByPlz = new Map(WIEN_BEZIRKE.map((bezirk) => [bezirk.plz, bezirk.number]))

/**
 * Returns the Vienna district for a postcode. Only the district postcodes
 * 1010 to 1230 count; PO box codes such as 1011 return null.
 */
export function bezirkFromPlz(plz: string | null | undefined): number | null {
  if (plz == null) return null
  return bezirkByPlz.get(plz.trim()) ?? null
}

export function bezirkName(number: number): string | null {
  return WIEN_BEZIRKE[number - 1]?.name ?? null
}
