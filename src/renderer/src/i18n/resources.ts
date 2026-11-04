import detailDe from '../features/detail/i18n/de.json'
import detailEn from '../features/detail/i18n/en.json'
import firstRunDe from '../features/first-run/i18n/de.json'
import firstRunEn from '../features/first-run/i18n/en.json'
import listingsDe from '../features/listings/i18n/de.json'
import listingsEn from '../features/listings/i18n/en.json'
import settingsDe from '../features/settings/i18n/de.json'
import settingsEn from '../features/settings/i18n/en.json'
import sharedDe from './de.json'
import sharedEn from './en.json'

/**
 * Strings used on several screens live next to this file; each feature folder
 * keeps its own namespaces in i18n/de.json and i18n/en.json. Every top-level
 * namespace belongs to exactly one file (tests/i18n.test.ts).
 */
export const translationFiles = {
  de: {
    shared: sharedDe,
    listings: listingsDe,
    detail: detailDe,
    settings: settingsDe,
    firstRun: firstRunDe,
  },
  en: {
    shared: sharedEn,
    listings: listingsEn,
    detail: detailEn,
    settings: settingsEn,
    firstRun: firstRunEn,
  },
}

// The English tree types `t` (i18next.d.ts); both languages have the same keys.
export const resources = {
  de: { translation: { ...sharedDe, ...listingsDe, ...detailDe, ...settingsDe, ...firstRunDe } },
  en: { translation: { ...sharedEn, ...listingsEn, ...detailEn, ...settingsEn, ...firstRunEn } },
} as const
