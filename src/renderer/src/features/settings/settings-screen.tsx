import { useTranslation } from 'react-i18next'
import {
  CheckCircleIcon,
  GlobeIcon,
  InfoIcon,
  RefreshIcon,
  SparklesIcon,
} from '../../components/ui/icons'
import { Page, PageHeader } from '../../components/ui/page'
import { AboutCard } from './about-card'
import { ConsentCard } from './consent-card'
import { DataSyncCard } from './data-sync-card'
import { LanguageCard } from './language-card'
import { ProvidersCard } from './providers/providers-card'

const SECTIONS = [
  { id: 'sync', label: 'settings.data.title', icon: RefreshIcon, content: DataSyncCard },
  { id: 'language', label: 'language.label', icon: GlobeIcon, content: LanguageCard },
  { id: 'providers', label: 'providers.title', icon: SparklesIcon, content: ProvidersCard },
  { id: 'consent', label: 'settings.consent.title', icon: CheckCircleIcon, content: ConsentCard },
  { id: 'about', label: 'settings.about.title', icon: InfoIcon, content: AboutCard },
] as const

export function SettingsScreen() {
  const { t } = useTranslation()
  return (
    <Page>
      <PageHeader title={t('settings.title')} />
      <div className="grid items-start gap-6 md:grid-cols-[auto_minmax(0,1fr)] lg:gap-8">
        <nav
          aria-label={t('settings.title')}
          className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-2 shadow-xs md:sticky md:top-6 md:w-48 md:flex-col"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#settings-${id}`}
              className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-fill-muted focus-visible:bg-accent-soft"
            >
              <Icon className="shrink-0 text-fg-muted" />
              {t(label)}
            </a>
          ))}
        </nav>
        <div className="flex min-w-0 max-w-3xl flex-col gap-6">
          {SECTIONS.map(({ id, content: Section }) => (
            <div key={id} id={`settings-${id}`} tabIndex={-1} className="scroll-mt-6 rounded-lg">
              <Section />
            </div>
          ))}
        </div>
      </div>
    </Page>
  )
}
