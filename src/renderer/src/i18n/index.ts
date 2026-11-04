import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Settings } from '@shared/domain'
import { resources } from './resources'

export type UiLanguage = keyof typeof resources

/** Locales for Intl number and date formatting. */
export const INTL_LOCALE: Readonly<Record<UiLanguage, string>> = { de: 'de-AT', en: 'en-GB' }

/** German for German-language systems, English otherwise. */
export function resolveLanguage(setting: Settings['language'], systemLocale: string): UiLanguage {
  if (setting !== 'system') return setting
  return systemLocale.toLowerCase().startsWith('de') ? 'de' : 'en'
}

export async function initI18n(language: UiLanguage): Promise<void> {
  await i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    // React escapes rendered text already.
    interpolation: { escapeValue: false },
  })
  document.documentElement.lang = language
}

export async function changeLanguage(language: UiLanguage): Promise<void> {
  await i18next.changeLanguage(language)
  document.documentElement.lang = language
}
