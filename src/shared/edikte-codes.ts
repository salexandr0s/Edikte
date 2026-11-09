import type { Bundesland, ListingStatus, NoticeType, PropertyType } from './enums'

// Site knowledge ported from immoradar packages/source-edikte/src/constants.ts.

export const EDIKTE_HOST = 'edikte.justiz.gv.at'
export const EDIKTE_ORIGIN = `https://${EDIKTE_HOST}`
/** Domino database for court auctions (Exekutionsedikte). */
export const EX_DB_PATH = '/edikte/ex/exedi3.nsf'

/** Values of the `BL` field in Domino search queries. */
export const BUNDESLAND_SITE_CODES: Readonly<Record<Bundesland, string>> = {
  wien: '0',
  noe: '1',
  bgld: '2',
  ooe: '3',
  sbg: '4',
  stmk: '5',
  ktn: '6',
  tirol: '7',
  vbg: '8',
}

/** JustizOnline publishes the sales in insolvency proceedings through a JSON API. */
export const JUSTIZONLINE_HOST = 'justizonline.gv.at'
export const JUSTIZONLINE_ORIGIN = `https://${JUSTIZONLINE_HOST}`
/** Root of the Ediktsdatei API. Every request and every file URL sits below it. */
export const JUSTIZONLINE_API_PATH = '/jop/service/edi/v1/'

/** Values of the `bl` filter in JustizOnline searches. */
export const BUNDESLAND_JUSTIZONLINE_CODES: Readonly<Record<Bundesland, string>> = {
  wien: 'WIEN',
  noe: 'NIEDEROESTERREICH',
  bgld: 'BURGENLAND',
  ooe: 'OBEROESTERREICH',
  sbg: 'SALZBURG',
  stmk: 'STEIERMARK',
  ktn: 'KAERNTEN',
  tirol: 'TIROL',
  vbg: 'VORARLBERG',
}

/** Names as the site writes them, used to read Bundesland values from pages. */
export const BUNDESLAND_SITE_NAMES: Readonly<Record<Bundesland, string>> = {
  wien: 'Wien',
  noe: 'Niederösterreich',
  bgld: 'Burgenland',
  ooe: 'Oberösterreich',
  sbg: 'Salzburg',
  stmk: 'Steiermark',
  ktn: 'Kärnten',
  tirol: 'Tirol',
  vbg: 'Vorarlberg',
}

export interface CategoryInfo {
  /** Label as the site writes it. */
  label: string
  propertyType: PropertyType
}

/** Values of the `VKat` field, with the site's labels. */
export const CATEGORIES = {
  EH: { label: 'Einfamilienhaus', propertyType: 'house' },
  ZH: { label: 'Zweifamilienhaus', propertyType: 'house' },
  MH: { label: 'Mehrfamilienhaus', propertyType: 'multi_family_house' },
  MW: { label: 'Mietwohnhaus', propertyType: 'multi_family_house' },
  MSH: { label: 'Mietshaus', propertyType: 'multi_family_house' },
  GGH: { label: 'gemischt genutztes Haus', propertyType: 'multi_family_house' },
  RH: { label: 'Reihenhaus', propertyType: 'house' },
  HAN: { label: 'Hausanteil', propertyType: 'house' },
  WE: { label: 'Wohnungseigentumsobjekt', propertyType: 'apartment' },
  EW: { label: 'Eigentumswohnung', propertyType: 'apartment' },
  MAI: { label: 'Maisonette', propertyType: 'apartment' },
  DTW: { label: 'Dachterrassenwohnung', propertyType: 'apartment' },
  DGW: { label: 'Dachgeschoßwohnung', propertyType: 'apartment' },
  GA: { label: 'Garconniere', propertyType: 'apartment' },
  GW: { label: 'Gartenwohnung', propertyType: 'apartment' },
  UL: { label: 'unbebaute Liegenschaft', propertyType: 'land' },
  BBL: { label: 'bebaubare Liegenschaft', propertyType: 'land' },
  LF: {
    label: 'land- und forstwirtschaftlich genutzte Liegenschaft',
    propertyType: 'agricultural',
  },
  GL: { label: 'gewerbliche Liegenschaft', propertyType: 'commercial' },
  SE: { label: 'Superädifikat', propertyType: 'other' },
  BR: { label: 'Baurecht', propertyType: 'other' },
  SO: { label: 'Sonstiges', propertyType: 'other' },
} as const satisfies Record<string, CategoryInfo>

export type CategoryCode = keyof typeof CATEGORIES

const categoryByLabel = new Map<string, CategoryCode>(
  Object.entries(CATEGORIES).map(([code, info]) => [
    normalizeLabel(info.label),
    code as CategoryCode,
  ]),
)

/** Finds the category code for a label as printed on a listing, if known. */
export function categoryCodeForLabel(label: string): CategoryCode | null {
  return categoryByLabel.get(normalizeLabel(label)) ?? null
}

/**
 * Notice types by the link text the search results start with.
 * Counts seen Austria-wide on 2026-11-04 are in the plan; unknown texts map to `other`.
 */
const NOTICE_PREFIXES: ReadonlyArray<readonly [prefix: string, type: NoticeType]> = [
  ['versteigerung', 'versteigerung'],
  ['meistbotsverteilung', 'meistbotsverteilung'],
  ['zuschlag ohne überbot', 'zuschlag_ohne_ueberbot'],
  ['zuschlag mit überbot', 'zuschlag_mit_ueberbot'],
  ['zuschlag nach überbot', 'zuschlag_nach_ueberbot'],
  ['entfall des termins', 'entfall'],
  ['verschiebung', 'verschiebung'],
  ['schriftliche anbote', 'schriftliche_anbote'],
]

export function noticeTypeForText(text: string): NoticeType {
  const normalized = normalizeLabel(text)
  for (const [prefix, type] of NOTICE_PREFIXES) {
    if (normalized.startsWith(prefix)) return type
  }
  return 'other'
}

export const STATUS_BY_NOTICE: Readonly<Record<NoticeType, ListingStatus>> = {
  versteigerung: 'upcoming',
  schriftliche_anbote: 'upcoming',
  verschiebung: 'postponed',
  entfall: 'cancelled',
  zuschlag_ohne_ueberbot: 'sold',
  zuschlag_mit_ueberbot: 'sold',
  zuschlag_nach_ueberbot: 'sold',
  meistbotsverteilung: 'closed',
  other: 'upcoming',
}

function normalizeLabel(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}
