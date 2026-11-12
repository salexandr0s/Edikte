import { useTranslation } from 'react-i18next'
import { Page, PageHeader } from '../../components/ui/page'
import { AboutCard } from './about-card'
import { ConsentCard } from './consent-card'
import { DataSyncCard } from './data-sync-card'
import { LanguageCard } from './language-card'
import { ProvidersCard } from './providers/providers-card'

export function SettingsScreen() {
  const { t } = useTranslation()
  return (
    <Page width="narrow">
      <PageHeader title={t('settings.title')} />
      <ProvidersCard />
      <DataSyncCard />
      <LanguageCard />
      <ConsentCard />
      <AboutCard />
    </Page>
  )
}
