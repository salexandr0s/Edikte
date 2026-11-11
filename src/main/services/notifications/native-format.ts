import type { NotificationSummary } from '@shared/notifications'
import de from '../../../renderer/src/features/notifications/i18n/de.json'
import en from '../../../renderer/src/features/notifications/i18n/en.json'
import listingsDe from '../../../renderer/src/features/listings/i18n/de.json'
import listingsEn from '../../../renderer/src/features/listings/i18n/en.json'
import type { DesktopMessage } from './native-adapter'

/** Main and the renderer use the same translated notification wording. */
export function formatNativeNotification(
  notification: NotificationSummary | null,
  language: 'de' | 'en',
): DesktopMessage {
  const strings = (language === 'de' ? de : en).notifications.desktop
  if (notification === null) return { title: strings.testTitle, body: strings.testBody }
  const name =
    notification.presetKey === null
      ? notification.filterName
      : (language === 'de' ? listingsDe : listingsEn).filters.presets[notification.presetKey]
  const title = strings.digestTitle.replace('{{name}}', name)
  const body = (
    notification.count === 1 ? strings.digestBody_one : strings.digestBody_other
  ).replace('{{count}}', new Intl.NumberFormat(language).format(notification.count))
  const dates = new Intl.DateTimeFormat(language === 'de' ? 'de-AT' : 'en-GB', {
    timeZone: 'Europe/Vienna',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const period = strings.period
    .replace('{{from}}', dates.format(new Date(notification.periodFrom)))
    .replace('{{to}}', dates.format(new Date(notification.periodTo)))
  return { title, body: `${body} ${period}` }
}
