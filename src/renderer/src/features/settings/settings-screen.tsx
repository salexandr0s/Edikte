import { useTranslation } from 'react-i18next'
import { AboutCard } from './about-card'
import { ConsentCard } from './consent-card'
import { DataSyncCard } from './data-sync-card'
import { LanguageCard } from './language-card'
import { ProvidersCard } from './providers/providers-card'

export function SettingsScreen() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
      <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
        {t('settings.title')}
      </h1>
      <ProvidersCard />
      <DataSyncCard />
      <LanguageCard />
      <ConsentCard />
      <AboutCard />
    </div>
  )
}
