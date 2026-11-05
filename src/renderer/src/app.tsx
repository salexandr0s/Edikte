import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from 'radix-ui'
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
import { useBridgeEvent } from './lib/use-bridge-event'

interface AppProps {
  info: AppInfo
  initialSettings: Settings
}

export function App({ info, initialSettings }: AppProps) {
  const [settings, setSettings] = useState(initialSettings)
  const [view, setView] = useState<View>(() =>
    initialSettings.firstRunCompletedAt === null ? { screen: 'firstRun' } : { screen: 'listings' },
  )

  // Counts settings writes and reloads; a reload applies only if nothing newer arrived meanwhile.
  const settingsRevision = useRef(0)

  const updateSettings = useCallback(
    async (patch: SettingsPatch) => {
      const next = await invoke('settings:update', patch)
      settingsRevision.current += 1
      setSettings(next)
      if (patch.language !== undefined) {
        await changeLanguage(resolveLanguage(next.language, info.systemLocale))
      }
      return next
    },
    [info.systemLocale],
  )

  // Main changes the selected provider, models and CLI paths when providers change.
  useBridgeEvent('providers:changed', () => {
    const revision = (settingsRevision.current += 1)
    invoke('settings:get').then(
      (next) => {
        if (settingsRevision.current === revision) setSettings(next)
      },
      // The next providers:changed event or settings write brings the state up to date.
      () => undefined,
    )
  })

  const context = useMemo<AppContextValue>(
    () => ({ info, settings, updateSettings, view, navigate: setView }),
    [info, settings, updateSettings, view],
  )

  return (
    <AppContext.Provider value={context}>
      <ToastProvider>
        <Tooltip.Provider delayDuration={300}>
          <AnalysisGateProvider>
            <Shell />
          </AnalysisGateProvider>
        </Tooltip.Provider>
      </ToastProvider>
    </AppContext.Provider>
  )
}

/**
 * Header, main area and footer. The listings screen stays mounted under the
 * other screens, so its filters and scroll position survive a visit to a
 * listing or to Settings. Each screen fills a scroll container of its own,
 * isolated so sticky headers inside stay below menus and dialogs in portals.
 */
function Shell() {
  const { t } = useTranslation()
  const { info, settings, updateSettings, view, navigate } = useApp()
  const toast = useToast()
  const [savingLanguage, setSavingLanguage] = useState(false)
  const firstRun = view.screen === 'firstRun'
  const section = view.screen === 'settings' ? 'settings' : 'listings'
  const listingsRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const shownView = useRef(view)

  // After a screen change, keyboard and screen reader users continue at the
  // new screen's heading, or on the list at the row of the listing they left.
  useEffect(() => {
    const previous = shownView.current
    shownView.current = view
    if (viewKey(previous) === viewKey(view)) return
    if (view.screen !== 'listings') return focusHeading(screenRef.current)
    const opener =
      previous.screen === 'detail'
        ? listingsRef.current?.querySelector<HTMLElement>(
            `[data-listing-link="${CSS.escape(previous.id)}"]`,
          )
        : null
    const target = opener ?? listingsRef.current?.querySelector('h1')
    target?.focus()
  }, [view])

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
          <div
            ref={listingsRef}
            inert={view.screen !== 'listings'}
            className="absolute inset-0 isolate overflow-auto"
          >
            <ListingsScreen />
          </div>
        )}
        {view.screen !== 'listings' && (
          <div ref={screenRef} className="absolute inset-0 isolate overflow-auto bg-bg">
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

function viewKey(view: View): string {
  return view.screen === 'detail' ? `detail:${view.id}` : view.screen
}

/**
 * Focuses the screen's h1 (tabIndex -1). The detail screen renders its h1
 * once the listing has loaded; that late heading takes focus only when no
 * other element has it by then. Returns the cleanup for the effect.
 */
function focusHeading(screen: HTMLElement | null): (() => void) | undefined {
  if (screen === null) return undefined
  const heading = screen.querySelector('h1')
  if (heading !== null) {
    heading.focus()
    return undefined
  }
  const observer = new MutationObserver(() => {
    const late = screen.querySelector('h1')
    if (late === null) return
    observer.disconnect()
    const active = document.activeElement
    if (active === null || active === document.body) late.focus()
  })
  observer.observe(screen, { childList: true, subtree: true })
  return () => observer.disconnect()
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
