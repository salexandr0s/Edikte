import { useTranslation } from 'react-i18next'

// Placeholder for the settings screen.
export function SettingsScreen() {
  const { t } = useTranslation()
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('nav.settings')}</h1>
    </div>
  )
}
