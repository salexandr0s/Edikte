import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LanguageSettingSchema,
  type AppInfo,
  type Settings,
  type SettingsPatch,
} from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import { AnalysisGateProvider } from './components/analysis-gate'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Select } from './components/ui/field'
import { ToastProvider, useToast } from './components/ui/toast'
import { DetailScreen } from './features/detail/detail-screen'
import { FirstRunScreen } from './features/first-run/first-run-screen'
import { ListingsScreen } from './features/listings/listings-screen'
import { SettingsScreen } from './features/settings/settings-screen'
import { changeLanguage, resolveLanguage } from './i18n'
import { AppContext, useApp, type AppContextValue, type View } from './lib/app-context'
import { errorCode, invoke, usingMockBridge } from './lib/bridge'
import { cx } from './lib/cx'

interface AppProps {
  info: AppInfo
  initialSettings: Settings
}

export function App({ info, initialSettings }: AppProps) {
  const [settings, setSettings] = useState(initialSettings)
  const [view, setView] = useState<View>(() =>
    initialSettings.firstRunCompletedAt === null ? { screen: 'firstRun' } : { screen: 'listings' },
  )

  const updateSettings = useCallback(
    async (patch: SettingsPatch) => {
      const next = await invoke('settings:update', patch)
      setSettings(next)
      if (patch.language !== undefined) {
        await changeLanguage(resolveLanguage(next.language, info.systemLocale))
      }
      return next
    },
    [info.systemLocale],
  )

  const context = useMemo<AppContextValue>(
    () => ({ info, settings, updateSettings, view, navigate: setView }),
    [info, settings, updateSettings, view],
  )

  return (
    <AppContext.Provider value={context}>
      <ToastProvider>
        <AnalysisGateProvider>
          <Shell />
        </AnalysisGateProvider>
      </ToastProvider>
    </AppContext.Provider>
  )
}

/**
 * Header, main area and footer. The listings screen stays mounted under the
 * other screens, so its filters and scroll position survive a visit to a
 * listing or to Settings. Each screen fills a scroll container of its own.
 */
function Shell() {
  const { t } = useTranslation()
  const { info, settings, updateSettings, view, navigate } = useApp()
  const toast = useToast()
  const [savingLanguage, setSavingLanguage] = useState(false)
  const firstRun = view.screen === 'firstRun'
  const section = view.screen === 'settings' ? 'settings' : 'listings'

  async function selectLanguage(value: string) {
    setSavingLanguage(true)
    try {
      await updateSettings({ language: LanguageSettingSchema.parse(value) })
    } catch (error) {
      toast({
        kind: 'error',
        title: t('language.saveFailed'),
        description: t(`errors.${errorCode(error)}`),
      })
    } finally {
      setSavingLanguage(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <a
        href="#main"
        className="sr-only rounded-sm bg-surface-elevated px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--edk-z-tooltip)"
      >
        {t('shell.skipToContent')}
      </a>
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-border bg-bg px-6">
        <span className="text-lg font-semibold tracking-tight">{t('app.name')}</span>
        {!firstRun && (
          <nav
            aria-label={t('nav.label')}
            className="flex items-center gap-0.5 rounded-md border border-border bg-bg-muted p-0.5"
          >
            <NavItem
              active={section === 'listings'}
              onClick={() => navigate({ screen: 'listings' })}
            >
              {t('nav.listings')}
            </NavItem>
            <NavItem
              active={section === 'settings'}
              onClick={() => navigate({ screen: 'settings' })}
            >
              {t('nav.settings')}
            </NavItem>
          </nav>
        )}
        {usingMockBridge && <Badge variant="warning">{t('shell.sampleData')}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="language" className="text-sm text-fg-muted">
            {t('language.label')}
          </label>
          <Select
            id="language"
            size="sm"
            className="w-auto"
            value={settings.language}
            disabled={savingLanguage}
            onChange={(event) => void selectLanguage(event.target.value)}
          >
            <option value="system">{t('language.system')}</option>
            <option value="de">{t('language.de')}</option>
            <option value="en">{t('language.en')}</option>
          </Select>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 outline-none">
        {!firstRun && (
          <div inert={view.screen !== 'listings'} className="absolute inset-0 overflow-auto">
            <ListingsScreen />
          </div>
        )}
        {view.screen !== 'listings' && (
          <div className="absolute inset-0 overflow-auto bg-bg">
            {view.screen === 'detail' && <DetailScreen key={view.id} id={view.id} />}
            {view.screen === 'settings' && <SettingsScreen />}
            {view.screen === 'firstRun' && <FirstRunScreen />}
          </div>
        )}
      </main>

      <footer className="flex shrink-0 gap-4 border-t border-border px-6 py-3 text-xs text-fg-muted">
        <span className="shrink-0">{t('shell.version', { version: info.version })}</span>
        <span className="truncate" title={info.dataDir}>
          {t('shell.dataDir', { path: info.dataDir })}
        </span>
      </footer>
    </div>
  )
}

function NavItem({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cx(
        'h-8 rounded-sm px-3 text-sm transition-colors',
        active
          ? 'bg-surface-elevated font-medium text-fg shadow-xs'
          : 'text-fg-muted hover:bg-surface-elevated hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

export function StartupError({ code }: { code: AppErrorCode }) {
  const { t } = useTranslation()
  return (
    <main
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <h1 className="text-xl font-semibold">{t('startup.failed')}</h1>
      <p className="max-w-md text-sm text-fg-muted">{t(`errors.${code}`)}</p>
      <Button className="mt-4" onClick={() => window.location.reload()}>
        {t('common.retry')}
      </Button>
    </main>
  )
}
