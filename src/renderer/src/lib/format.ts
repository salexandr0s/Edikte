import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { INTL_LOCALE, type UiLanguage } from '../i18n'

// Money in whole euros, areas with up to two decimals. Dates from the site are
// Vienna local time and are shown as published, never converted. Timestamps
// written by the app are UTC and are shown in the computer's time zone.

export interface Formatters {
  eur(value: number): string
  /** Whole euros per m², e.g. "€ 4.861/m²". */
  eurPerSqm(value: number): string
  sqm(value: number): string
  number(value: number, maximumFractionDigits?: number): string
  usd(value: number): string
  /** A site date, "YYYY-MM-DD". */
  localDate(value: string): string
  /** A site date and time, "YYYY-MM-DDTHH:mm". */
  localDateTime(value: string): string
  /** The time of a site date and time, or null when the value is a date alone. */
  localTime(value: string): string | null
  /** An ISO timestamp written by the app. */
  timestamp(value: string): string
  fileSize(kb: number): string
}

/** Keeps a number and its unit on one line. */
const NBSP = String.fromCharCode(0xa0)

export function createFormatters(language: UiLanguage): Formatters {
  const locale = INTL_LOCALE[language]
  const eur = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  })
  const usd = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const numberFormats = new Map<number, Intl.NumberFormat>()
  const number = (value: number, maximumFractionDigits = 0): string => {
    let format = numberFormats.get(maximumFractionDigits)
    if (format === undefined) {
      format = new Intl.NumberFormat(locale, { maximumFractionDigits })
      numberFormats.set(maximumFractionDigits, format)
    }
    return format.format(value)
  }
  // Site dates carry no time zone; formatting them as UTC keeps them unchanged.
  const siteDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const siteDateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
  const siteTime = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'UTC' })
  const appTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  return {
    eur: (value) => eur.format(value),
    eurPerSqm: (value) => `${eur.format(Math.round(value))}/m²`,
    sqm: (value) => `${number(value, 2)}${NBSP}m²`,
    number,
    usd: (value) => usd.format(value),
    localDate: (value) => formatSiteTime(siteDate, value),
    localDateTime: (value) => formatSiteTime(siteDateTime, value),
    localTime: (value) => (value.includes('T') ? formatSiteTime(siteTime, value) : null),
    timestamp: (value) => {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? value : appTime.format(date)
    },
    fileSize: (kb) => (kb < 1024 ? `${number(kb)}${NBSP}KB` : `${number(kb / 1024, 1)}${NBSP}MB`),
  }
}

function formatSiteTime(format: Intl.DateTimeFormat, value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value)
  if (match === null) return value
  const [, year, month, day, hour = '0', minute = '0'] = match
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  return format.format(new Date(utc))
}

/** Formatters for the current UI language; components re-render on a language switch. */
export function useFormat(): Formatters {
  const { i18n } = useTranslation()
  const language: UiLanguage = i18n.language === 'de' ? 'de' : 'en'
  return useMemo(() => createFormatters(language), [language])
}
