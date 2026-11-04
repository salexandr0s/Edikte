import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSettingSchema, type AppInfo, type Settings } from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import { changeLanguage, resolveLanguage } from './i18n'
import { errorCode, invoke, usingMockBridge } from './lib/bridge'

// Scaffold shell: app name, language setting and an app-info round trip.
// The listings, detail and settings screens replace the main area.

interface AppProps {
  info: AppInfo
  initialSettings: Settings
}

export function App({ info, initialSettings }: AppProps) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<AppErrorCode | null>(null)

  async function selectLanguage(value: string) {
    setSaving(true)
    setError(null)
    try {
      const next = await invoke('settings:update', { language: LanguageSettingSchema.parse(value) })
      setSettings(next)
      await changeLanguage(resolveLanguage(next.language, info.systemLocale))
    } catch (cause) {
      setError(errorCode(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-(--edk-z-sticky) flex h-14 items-center gap-4 border-b border-border bg-bg px-6">
        <span className="text-lg font-semibold tracking-tight">{t('app.name')}</span>
        {usingMockBridge && (
          <span className="inline-flex h-6 items-center rounded-full bg-amber-100 px-2 text-xs font-medium text-amber-700">
            {t('shell.sampleData')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="language" className="text-sm text-fg-muted">
            {t('language.label')}
          </label>
          <select
            id="language"
            value={settings.language}
            disabled={saving}
            onChange={(event) => void selectLanguage(event.target.value)}
            className="h-8 rounded-sm border border-border-strong bg-surface px-3 text-sm text-fg transition-colors hover:bg-bg-muted disabled:cursor-not-allowed disabled:opacity-55"
          >
            <option value="system">{t('language.system')}</option>
            <option value="de">{t('language.de')}</option>
            <option value="en">{t('language.en')}</option>
          </select>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('listings.title')}</h1>
        <p className="mt-2 text-sm text-fg-muted">{t('listings.empty')}</p>
        {error !== null && (
          <p role="alert" className="mt-4 text-sm text-danger-text">
            {t(`errors.${error}`)}
          </p>
        )}
      </main>

      <footer className="flex gap-4 border-t border-border px-6 py-3 text-xs text-fg-muted">
        <span className="shrink-0">{t('shell.version', { version: info.version })}</span>
        <span className="truncate" title={info.dataDir}>
          {t('shell.dataDir', { path: info.dataDir })}
        </span>
      </footer>
    </div>
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
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 h-10 rounded-md bg-accent-fill px-4 text-sm font-medium text-white transition-colors hover:bg-accent-fill-hover active:translate-y-px"
      >
        {t('common.retry')}
      </button>
    </main>
  )
}
